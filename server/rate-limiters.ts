import rateLimit from "express-rate-limit";

/**
 * Tiered rate limiting for different route categories
 * Prevents brute force attacks, data scraping, and resource exhaustion
 */

/**
 * Authentication rate limiter - most restrictive
 * Used for: login, register, password reset
 * 
 * Limit: 5 requests per minute per IP
 * Prevents brute force credential attacks
 */
export const authRateLimiter = rateLimit({
  windowMs: 60 * 1000, // 1 minute
  max: 5, // 5 requests per window
  message: {
    error: "Too many authentication attempts",
    message: "You have exceeded the maximum number of login attempts. Please try again in 1 minute.",
  },
  standardHeaders: true,
  legacyHeaders: false,
  // Use proxy-aware configuration for cloud/edge deployments (Replit, etc.)
  // Trust the X-Forwarded-For header to get real client IP
  validate: {
    trustProxy: false, // Disable validation - we manually configure trust proxy in index.ts
  },
});

/**
 * Sensitive operations rate limiter - restrictive
 * Used for: admin operations, backups, API key management, database operations
 * 
 * Limit: 20 requests per minute per IP
 * Prevents abuse of sensitive administrative functions
 */
export const sensitiveRateLimiter = rateLimit({
  windowMs: 60 * 1000, // 1 minute
  max: 20, // 20 requests per window
  message: {
    error: "Too many sensitive operations",
    message: "You have exceeded the rate limit for sensitive operations. Please try again in 1 minute.",
  },
  standardHeaders: true,
  legacyHeaders: false,
  validate: {
    trustProxy: false,
  },
});

/**
 * General CRUD operations rate limiter - moderate
 * Used for: standard CRUD operations (accounts, contacts, leads, opportunities, activities)
 * 
 * Limit: 100 requests per minute per IP
 * Prevents automated scraping and resource exhaustion
 */
export const crudRateLimiter = rateLimit({
  windowMs: 60 * 1000, // 1 minute
  max: 100, // 100 requests per window
  message: {
    error: "Too many requests",
    message: "You have exceeded the rate limit. Please try again in 1 minute.",
  },
  standardHeaders: true,
  legacyHeaders: false,
  validate: {
    trustProxy: false,
  },
});

/**
 * Read-only operations rate limiter - least restrictive
 * Used for: GET requests, data fetching, dashboards
 * 
 * Limit: 200 requests per minute per IP
 * Allows high-frequency reads while preventing abuse
 */
export const readRateLimiter = rateLimit({
  windowMs: 60 * 1000, // 1 minute
  max: 200, // 200 requests per window
  message: {
    error: "Too many requests",
    message: "You have exceeded the rate limit for read operations. Please try again in 1 minute.",
  },
  standardHeaders: true,
  legacyHeaders: false,
  validate: {
    trustProxy: false,
  },
  skip: (req) => {
    // Skip rate limiting for CSRF token endpoint (needed before auth)
    return req.path === '/api/csrf-token';
  },
});
