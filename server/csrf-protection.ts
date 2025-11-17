import { Request, Response, NextFunction } from "express";
import crypto from "crypto";

/**
 * Custom CSRF protection middleware
 * Generates and validates CSRF tokens using session storage
 */

interface SessionWithCsrf extends Express.Session {
  csrfToken?: string;
}

/**
 * Generates a random CSRF token and stores it in the session
 */
export function generateCsrfToken(req: Request): string {
  const session = req.session as SessionWithCsrf;
  
  // Generate new token if one doesn't exist
  if (!session.csrfToken) {
    session.csrfToken = crypto.randomBytes(32).toString('hex');
  }
  
  return session.csrfToken;
}

/**
 * Middleware to validate CSRF tokens on state-changing requests
 * Exempts:
 * - GET, HEAD, OPTIONS requests (safe methods)
 * - External API routes (use API key authentication instead)
 * - Login route (needs to work before CSRF token is available)
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

  // Skip CSRF for login route (user doesn't have token yet)
  if (req.path === '/api/login') {
    return next();
  }

  // Get token from session and request
  const session = req.session as SessionWithCsrf;
  const sessionToken = session.csrfToken;
  
  // Get token from header or body
  const requestToken = req.headers['x-csrf-token'] as string || req.body._csrf;

  // Validate token
  if (!sessionToken || !requestToken) {
    console.error('CSRF token missing', {
      path: req.path,
      method: req.method,
      hasSessionToken: !!sessionToken,
      hasRequestToken: !!requestToken,
    });
    return res.status(403).json({ 
      error: 'CSRF token missing',
      message: 'Invalid or missing CSRF token. Please refresh and try again.',
    });
  }

  // Use timing-safe comparison to prevent timing attacks
  const sessionBuffer = Buffer.from(sessionToken);
  const requestBuffer = Buffer.from(requestToken);
  
  if (sessionBuffer.length !== requestBuffer.length || 
      !crypto.timingSafeEqual(sessionBuffer, requestBuffer)) {
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
