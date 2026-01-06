import rateLimit from "express-rate-limit";

/**
 * Tiered rate limiting for different route categories
 * Prevents brute force attacks, data scraping, and resource exhaustion
 * 
 * Rate limiting can be disabled by setting DISABLE_RATE_LIMITING=true
 * This is useful for Docker/self-hosted deployments
 */

const isRateLimitingDisabled = process.env.DISABLE_RATE_LIMITING === 'true';

/**
 * Authentication rate limiter - most restrictive
 * Used for: login, register, password reset
 * 
 * Limit: 10 requests per minute per IP (increased for better UX)
 * Prevents brute force credential attacks
 */
export const authRateLimiter = rateLimit({
  windowMs: 60 * 1000, // 1 minute
  max: isRateLimitingDisabled ? 10000 : 10, // 10 requests per window (or effectively unlimited if disabled)
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
  skip: () => isRateLimitingDisabled,
});

/**
 * Sensitive operations rate limiter - restrictive
 * Used for: admin operations, backups, API key management, database operations
 * 
 * Limit: 50 requests per minute per IP (increased for admin workflows)
 * Prevents abuse of sensitive administrative functions
 */
export const sensitiveRateLimiter = rateLimit({
  windowMs: 60 * 1000, // 1 minute
  max: isRateLimitingDisabled ? 10000 : 50, // 50 requests per window
  message: {
    error: "Too many sensitive operations",
    message: "You have exceeded the rate limit for sensitive operations. Please try again in 1 minute.",
  },
  standardHeaders: true,
  legacyHeaders: false,
  validate: {
    trustProxy: false,
  },
  skip: () => isRateLimitingDisabled,
});

/**
 * General CRUD operations rate limiter - moderate
 * Used for: standard CRUD operations (accounts, contacts, leads, opportunities, activities)
 * 
 * Limit: 300 requests per minute per IP (increased for SPA parallel requests)
 * Prevents automated scraping and resource exhaustion
 */
export const crudRateLimiter = rateLimit({
  windowMs: 60 * 1000, // 1 minute
  max: isRateLimitingDisabled ? 10000 : 300, // 300 requests per window
  message: {
    error: "Too many requests",
    message: "You have exceeded the rate limit. Please try again in 1 minute.",
  },
  standardHeaders: true,
  legacyHeaders: false,
  validate: {
    trustProxy: false,
  },
  skip: () => isRateLimitingDisabled,
});

/**
 * Read-only operations rate limiter - least restrictive
 * Used for: GET requests, data fetching, dashboards
 * 
 * Limit: 600 requests per minute per IP (increased for dashboard parallel loading)
 * Allows high-frequency reads while preventing abuse
 */
export const readRateLimiter = rateLimit({
  windowMs: 60 * 1000, // 1 minute
  max: isRateLimitingDisabled ? 10000 : 600, // 600 requests per window
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
    // Skip rate limiting if disabled or for CSRF token endpoint (needed before auth)
    return isRateLimitingDisabled || req.path === '/api/csrf-token';
  },
});
