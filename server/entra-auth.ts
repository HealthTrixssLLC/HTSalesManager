/**
 * Microsoft Entra ID (Azure AD) SSO — OAuth 2.0 Authorization Code Flow
 * Routes: GET /api/auth/entra/login, /callback, /me
 */

import { Request, Response } from "express";
import jwt from "jsonwebtoken";
import crypto from "crypto";
import { storage } from "./db";
import { hashPassword, authenticate, type AuthRequest } from "./auth";
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
   * Step 2: Exchange the authorization code for tokens, then find/create a local
   * CRM user and issue a JWT. Redirect to /auth?token=<jwt> so the frontend can
   * store the token in localStorage per spec.
   */
  app.get("/api/auth/entra/callback", async (req: Request, res: Response) => {
    try {
      const { code, state, error, error_description } = req.query as Record<string, string>;

      if (error) {
        console.error("[Entra] OAuth error:", error, error_description);
        return res.redirect(`/auth?sso_error=${encodeURIComponent(error_description || error)}`);
      }

      const storedState = req.cookies?.entra_state;
      if (!state || !storedState || state !== storedState) {
        console.error("[Entra] State mismatch — possible CSRF");
        return res.redirect("/auth?sso_error=invalid_state");
      }

      res.clearCookie("entra_state");

      const redirectUri = buildRedirectUri(req);

      // Exchange code for tokens
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
        jobTitle?: string;
      };

      const email = profile.mail || profile.userPrincipalName;
      const name = profile.displayName;

      if (!email || !name) {
        console.error("[Entra] Missing email/name in profile:", profile);
        return res.redirect("/auth?sso_error=missing_profile");
      }

      // Find or create local CRM user
      let user = await storage.getUserByEmail(email);

      if (!user) {
        // Auto-provision new user with a random unusable password
        const randomPassword = await hashPassword(crypto.randomBytes(32).toString("hex"));
        user = await storage.createUser({ email, name, password: randomPassword });

        // Assign default SalesRep role
        try {
          const roles = await storage.getAllRoles();
          const defaultRole = roles.find((r) => r.name === "SalesRep");
          if (defaultRole) {
            await storage.assignRoleToUser(user.id, defaultRole.id);
          }
        } catch (roleErr) {
          console.error("[Entra] Error assigning role:", roleErr);
        }

        console.log(`[Entra] Auto-provisioned new user: ${email}`);
      } else {
        console.log(`[Entra] Existing user signed in via Entra: ${email}`);
      }

      // Issue an 8-hour JWT signed with the same SESSION_SECRET
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

      // Redirect to /auth with token param — frontend will store in localStorage
      return res.redirect(`/auth?token=${encodeURIComponent(token)}`);
    } catch (err) {
      console.error("[Entra] Callback error:", err);
      return res.redirect("/auth?sso_error=server_error");
    }
  });

  /**
   * GET /api/auth/entra/me — Return the currently authenticated user profile.
   * Works for both SSO and password-based users (uses existing authenticate middleware).
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
