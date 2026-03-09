/**
 * Microsoft Entra ID (Azure AD) SSO — OAuth 2.0 Authorization Code Flow
 * Routes: GET /api/auth/entra/login, /callback, /me
 *
 * Access control policy:
 *  - Auto-provisioning is DISABLED. Only pre-existing CRM accounts can sign in via SSO.
 *  - User account must have status = "active".
 *  - User must have at least one CRM role assigned.
 * CRM admins control who can log in by managing user accounts in the Admin Console.
 */

import { Request, Response } from "express";
import jwt from "jsonwebtoken";
import crypto from "crypto";
import { storage } from "./db";
import { authenticate, type AuthRequest } from "./auth";
import type { Express } from "express";

const JWT_SECRET = process.env.SESSION_SECRET || "health-trixss-crm-secret-key";
const TENANT_ID = process.env.AZURE_TENANT_ID!;
const CLIENT_ID = process.env.AZURE_CLIENT_ID!;
const CLIENT_SECRET = process.env.AZURE_CLIENT_SECRET!;

const MICROSOFT_AUTHORIZE_URL = `https://login.microsoftonline.com/${TENANT_ID}/oauth2/v2.0/authorize`;
const MICROSOFT_TOKEN_URL = `https://login.microsoftonline.com/${TENANT_ID}/oauth2/v2.0/token`;
const GRAPH_ME_URL = "https://graph.microsoft.com/v1.0/me";
const SCOPES = "openid profile email User.Read";

function buildRedirectUri(req: Request): string {
  const proto = req.headers["x-forwarded-proto"] ?? req.protocol;
  const host = req.headers["x-forwarded-host"] ?? req.headers.host;
  return `${proto}://${host}/api/auth/entra/callback`;
}

function getClientIp(req: Request): string | null {
  return (
    (req.headers["x-forwarded-for"] as string)?.split(",")[0]?.trim() ||
    req.ip ||
    null
  );
}

async function logSsoEvent(
  action: string,
  userId: string | null,
  email: string,
  detail: Record<string, unknown>,
  req: Request
) {
  try {
    await storage.createAuditLog({
      actorId: userId,
      action,
      resource: "User",
      resourceId: userId,
      before: null,
      after: { email, authProvider: "entra_sso", ...detail },
      ipAddress: getClientIp(req),
      userAgent: req.headers["user-agent"] || null,
    });
  } catch (err) {
    console.error("[Entra] Failed to write audit log:", err);
  }
}

export function registerEntraRoutes(app: Express): void {
  /**
   * Step 1: Redirect the user to Microsoft's login page.
   */
  app.get("/api/auth/entra/login", (req: Request, res: Response) => {
    if (!TENANT_ID || !CLIENT_ID) {
      return res.status(503).json({ error: "Microsoft SSO is not configured" });
    }

    const state = crypto.randomBytes(16).toString("hex");

    res.cookie("entra_state", state, {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      maxAge: 10 * 60 * 1000, // 10 minutes
    });

    const params = new URLSearchParams({
      client_id: CLIENT_ID,
      response_type: "code",
      redirect_uri: buildRedirectUri(req),
      scope: SCOPES,
      state,
      response_mode: "query",
    });

    return res.redirect(`${MICROSOFT_AUTHORIZE_URL}?${params.toString()}`);
  });

  /**
   * Step 2: Microsoft redirects back here with an authorization code.
   * Validate the code, check CRM access, issue a JWT, and redirect to /auth?token=<jwt>.
   */
  app.get("/api/auth/entra/callback", async (req: Request, res: Response) => {
    try {
      const { code, state, error, error_description } = req.query as Record<string, string>;

      // Microsoft returned an error (e.g. user cancelled)
      if (error) {
        console.error("[Entra] OAuth error:", error, error_description);
        return res.redirect(`/auth?sso_error=${encodeURIComponent(error_description || error)}`);
      }

      // CSRF state validation
      const storedState = req.cookies?.entra_state;
      if (!state || !storedState || state !== storedState) {
        console.error("[Entra] State mismatch — possible CSRF");
        return res.redirect("/auth?sso_error=invalid_state");
      }

      res.clearCookie("entra_state");

      const redirectUri = buildRedirectUri(req);

      // Exchange authorization code for tokens
      const tokenRes = await fetch(MICROSOFT_TOKEN_URL, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          client_id: CLIENT_ID,
          client_secret: CLIENT_SECRET,
          code,
          redirect_uri: redirectUri,
          grant_type: "authorization_code",
        }).toString(),
      });

      const tokens = await tokenRes.json() as { access_token?: string; error?: string };

      if (!tokens.access_token) {
        console.error("[Entra] Token exchange failed:", tokens);
        return res.redirect("/auth?sso_error=token_exchange_failed");
      }

      // Fetch profile from Microsoft Graph
      const profileRes = await fetch(GRAPH_ME_URL, {
        headers: { Authorization: `Bearer ${tokens.access_token}` },
      });

      const profile = await profileRes.json() as {
        displayName?: string;
        mail?: string;
        userPrincipalName?: string;
      };

      const email = profile.mail || profile.userPrincipalName;

      if (!email) {
        console.error("[Entra] Missing email in Microsoft profile:", profile);
        return res.redirect("/auth?sso_error=missing_profile");
      }

      // ── Access Control Check 1: Account must exist in the CRM ──────────────
      const userWithPassword = await storage.getUserByEmail(email);

      if (!userWithPassword) {
        console.warn(`[Entra] SSO login rejected — no CRM account for: ${email}`);
        await logSsoEvent("sso_login_rejected", null, email, { reason: "account_not_found" }, req);
        return res.redirect(
          "/auth?sso_error=" +
            encodeURIComponent(
              "Your account has not been set up in the CRM. Contact your administrator."
            )
        );
      }

      const user = await storage.getUserById(userWithPassword.id);
      if (!user) {
        return res.redirect("/auth?sso_error=server_error");
      }

      // ── Access Control Check 2: Account must be active ─────────────────────
      if (user.status !== "active") {
        console.warn(`[Entra] SSO login rejected — account inactive/suspended: ${email} (status: ${user.status})`);
        await logSsoEvent("sso_login_rejected", user.id, email, { reason: "account_not_active", status: user.status }, req);
        return res.redirect(
          "/auth?sso_error=" +
            encodeURIComponent(
              "Your account has been suspended. Contact your administrator."
            )
        );
      }

      // ── Access Control Check 3: Must have at least one CRM role ────────────
      const userRoles = await storage.getUserRoles(user.id);

      if (!userRoles || userRoles.length === 0) {
        console.warn(`[Entra] SSO login rejected — no roles assigned: ${email}`);
        await logSsoEvent("sso_login_rejected", user.id, email, { reason: "no_roles_assigned" }, req);
        return res.redirect(
          "/auth?sso_error=" +
            encodeURIComponent(
              "Your account has no permissions assigned. Contact your administrator."
            )
        );
      }

      // ── All checks passed — issue JWT ───────────────────────────────────────
      const token = jwt.sign(
        { id: user.id, email: user.email },
        JWT_SECRET,
        { expiresIn: "8h" }
      );

      // Set standard HTTP-only cookie so all existing API routes work immediately
      res.cookie("token", token, {
        httpOnly: true,
        secure: process.env.NODE_ENV === "production",
        sameSite: "lax",
        maxAge: 8 * 60 * 60 * 1000, // 8 hours
      });

      // Audit log the successful SSO login
      await logSsoEvent("sso_login_success", user.id, email, {
        roles: userRoles.map((r) => r.name),
      }, req);

      console.log(`[Entra] SSO login success: ${email} (roles: ${userRoles.map((r) => r.name).join(", ")})`);

      // Redirect to /auth with token param — frontend stores in localStorage
      return res.redirect(`/auth?token=${encodeURIComponent(token)}`);
    } catch (err) {
      console.error("[Entra] Callback error:", err);
      return res.redirect("/auth?sso_error=server_error");
    }
  });

  /**
   * GET /api/auth/entra/me — Return the currently authenticated user profile.
   * Works for both SSO and password-based sessions (uses existing authenticate middleware).
   */
  app.get("/api/auth/entra/me", authenticate, (req: AuthRequest, res: Response) => {
    const user = req.user!;
    return res.json({
      id: user.id,
      email: user.email,
      name: user.name,
    });
  });
}
