import { Request, Response, NextFunction } from "express";
import crypto from "crypto";

/**
 * Custom CSRF protection middleware using Double Submit Cookie pattern
 * Works with JWT-based authentication (stateless)
 * 
 * How it works:
 * 1. Generate a random CSRF token and send it in a cookie
 * 2. Client must include the same token in X-CSRF-Token header for state-changing requests
 * 3. Server validates that cookie token matches header token
 */

const CSRF_COOKIE_NAME = "_csrf";

/**
 * Generates a random CSRF token and sets it in a cookie
 * This token must be included in the X-CSRF-Token header for state-changing requests
 */
export function generateCsrfToken(req: Request, res: Response): string {
  // Check if token already exists in cookie
  let token = req.cookies?.[CSRF_COOKIE_NAME];
  
  // Generate new token if one doesn't exist
  if (!token) {
    token = crypto.randomBytes(32).toString('hex');
    
    // Set secure cookie with SameSite protection
    res.cookie(CSRF_COOKIE_NAME, token, {
      httpOnly: true,  // Prevent JavaScript access
      secure: process.env.NODE_ENV === 'production',  // HTTPS only in production
      sameSite: 'strict',  // Prevent CSRF attacks
      maxAge: 7 * 24 * 60 * 60 * 1000,  // 7 days (matches JWT expiry)
    });
  }
  
  return token;
}

/**
 * Middleware to validate CSRF tokens on state-changing requests
 * Uses Double Submit Cookie pattern - validates that cookie matches header
 * 
 * Exempts:
 * - GET, HEAD, OPTIONS requests (safe methods)
 * - External API routes (use API key authentication instead)
 * - Login/register routes (user doesn't have token yet)
 */
export function csrfProtection(req: Request, res: Response, next: NextFunction) {
  // Skip CSRF for safe HTTP methods
  if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) {
    return next();
  }

  // Skip CSRF for external API routes (they use API key auth)
  if (req.path.startsWith('/api/v1/external')) {
    return next();
  }

  // Skip CSRF for login/register routes (user doesn't have token yet)
  if (req.path === '/api/login' || req.path === '/api/register') {
    return next();
  }

  // Get token from cookie and header
  const cookieToken = req.cookies?.[CSRF_COOKIE_NAME];
  const headerToken = req.headers['x-csrf-token'] as string;

  // Validate tokens exist
  if (!cookieToken || !headerToken) {
    console.error('CSRF token missing', {
      path: req.path,
      method: req.method,
      hasCookieToken: !!cookieToken,
      hasHeaderToken: !!headerToken,
    });
    return res.status(403).json({ 
      error: 'CSRF token missing',
      message: 'Invalid or missing CSRF token. Please refresh and try again.',
    });
  }

  // Use timing-safe comparison to prevent timing attacks
  const cookieBuffer = Buffer.from(cookieToken);
  const headerBuffer = Buffer.from(headerToken);
  
  if (cookieBuffer.length !== headerBuffer.length || 
      !crypto.timingSafeEqual(cookieBuffer, headerBuffer)) {
    console.error('CSRF token mismatch', {
      path: req.path,
      method: req.method,
    });
    return res.status(403).json({ 
      error: 'CSRF token invalid',
      message: 'Invalid CSRF token. Please refresh and try again.',
    });
  }

  // Token is valid
  next();
}
