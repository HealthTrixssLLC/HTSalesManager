import { Request, Response, NextFunction } from "express";
import crypto from "crypto";

/**
 * Custom CSRF protection middleware using Double Submit Cookie pattern
 * Works with JWT-based authentication (stateless)
 *
 * How it works:
 * 1. Generate a random CSRF token and send it in a readable cookie
 * 2. Client reads the cookie via document.cookie and mirrors it in the X-CSRF-Token header
 * 3. Server validates that cookie token matches header token
 *
 * Note: The cookie is NOT httpOnly so that JavaScript can read it — this is required
 * by the Double Submit Cookie pattern. The cookie being JS-readable is safe here because
 * an attacker running JS on our origin could already do anything; the protection is
 * against cross-origin requests which cannot read same-origin cookies.
 */

const CSRF_COOKIE_NAME = "csrf_token";

/**
 * Generates a random CSRF token and sets it in a readable cookie.
 * Called by GET /api/csrf-token on first page load.
 */
export function generateCsrfToken(req: Request, res: Response): string {
  let token = req.cookies?.[CSRF_COOKIE_NAME];

  if (!token) {
    token = crypto.randomBytes(32).toString("hex");
  }

  res.cookie(CSRF_COOKIE_NAME, token, {
    httpOnly: false,
    secure: process.env.NODE_ENV === "production",
    sameSite: "strict",
    maxAge: 7 * 24 * 60 * 60 * 1000,
    path: "/",
  });

  return token;
}

/**
 * Middleware to validate CSRF tokens on state-changing requests.
 * Exempts safe methods, external API routes, and auth endpoints.
 */
export function csrfProtection(req: Request, res: Response, next: NextFunction) {
  if (["GET", "HEAD", "OPTIONS"].includes(req.method)) {
    return next();
  }

  if (req.path.startsWith("/api/v1/external")) {
    return next();
  }

  if (req.path === "/api/login" || req.path === "/api/register") {
    return next();
  }

  const cookieToken = req.cookies?.[CSRF_COOKIE_NAME];
  const headerToken = req.headers["x-csrf-token"] as string;

  if (!cookieToken || !headerToken) {
    console.error("CSRF token missing", {
      path: req.path,
      method: req.method,
      hasCookieToken: !!cookieToken,
      hasHeaderToken: !!headerToken,
    });
    return res.status(403).json({
      error: "CSRF token missing",
      message: "Invalid or missing CSRF token. Please refresh and try again.",
    });
  }

  const cookieBuffer = Buffer.from(cookieToken);
  const headerBuffer = Buffer.from(headerToken);

  if (
    cookieBuffer.length !== headerBuffer.length ||
    !crypto.timingSafeEqual(cookieBuffer, headerBuffer)
  ) {
    console.error("CSRF token mismatch", { path: req.path, method: req.method });
    return res.status(403).json({
      error: "CSRF token invalid",
      message: "Invalid CSRF token. Please refresh and try again.",
    });
  }

  next();
}
