// API Key authentication middleware
// For external integrations and forecasting app access

import { Request, Response, NextFunction } from "express";
import rateLimit from "express-rate-limit";
import { storage } from "./db";
import { verifyApiKey, validateApiKeyFormat } from "./api-key-utils";

export interface ApiKeyRequest extends Request {
  apiKey?: {
    id: string;
    name: string;
    description: string | null;
    rateLimitPerMin: number | null;
  };
}

/**
 * Helper to log authentication failures (fire-and-forget for performance)
 */
function logAuthFailure(
  req: Request,
  statusCode: number,
  error: string,
  message: string,
  apiKeyId: string | null = null
) {
  // Fire and forget - don't block request processing
  storage.createAuditLog({
    actorId: null,
    action: "external_api_auth_failure",
    resource: "api_key",
    resourceId: apiKeyId,
    before: null,
    after: {
      endpoint: req.path,
      method: req.method,
      statusCode,
      error,
      message,
      apiKeyProvided: !!req.headers["x-api-key"],
      apiKeyFormat: req.headers["x-api-key"] ? "provided" : "missing",
      timestamp: new Date().toISOString(),
    },
    ipAddress: req.ip || req.connection.remoteAddress || null,
    userAgent: req.headers["user-agent"] || null,
  }).catch(err => {
    console.error("[API-AUTH] Failed to log auth failure:", err);
  });
}

/**
 * Middleware to authenticate requests using API keys
 * Checks x-api-key header, validates format, verifies against database
 * Updates lastUsedAt timestamp on successful auth
 * Logs all authentication attempts (success and failure) for compliance
 */
export async function authenticateApiKey(
  req: ApiKeyRequest,
  res: Response,
  next: NextFunction
) {
  try {
    // Get API key from header
    const providedKey = req.headers["x-api-key"] as string;
    
    if (!providedKey) {
      const errorData = {
        error: "API key required",
        message: "Please provide your API key in the x-api-key header"
      };
      
      // Log authentication failure (fire-and-forget)
      logAuthFailure(req, 401, errorData.error, errorData.message);
      
      return res.status(401).json(errorData);
    }
    
    // Validate format
    if (!validateApiKeyFormat(providedKey)) {
      const errorData = {
        error: "Invalid API key format",
        message: "The provided API key format is invalid"
      };
      
      // Log authentication failure (fire-and-forget)
      logAuthFailure(req, 401, errorData.error, errorData.message);
      
      return res.status(401).json(errorData);
    }
    
    // Get all active API keys and check against each hashed key
    // This is necessary because bcrypt requires comparison against the hash
    const apiKeys = await storage.getAllApiKeys();
    const activeKeys = apiKeys.filter(k => k.isActive && !k.revokedAt);
    
    let matchedKey = null;
    
    for (const key of activeKeys) {
      const isValid = await verifyApiKey(providedKey, key.hashedKey);
      if (isValid) {
        matchedKey = key;
        break;
      }
    }
    
    if (!matchedKey) {
      const errorData = {
        error: "Invalid API key",
        message: "The provided API key is invalid or has been revoked"
      };
      
      // Log authentication failure (fire-and-forget, no API key ID since we couldn't match it)
      logAuthFailure(req, 401, errorData.error, errorData.message);
      
      return res.status(401).json(errorData);
    }
    
    // Check if key has expired
    if (matchedKey.expiresAt && new Date(matchedKey.expiresAt) < new Date()) {
      const errorData = {
        error: "API key expired",
        message: "The provided API key has expired"
      };
      
      // Log authentication failure with matched key ID (fire-and-forget)
      logAuthFailure(req, 401, errorData.error, errorData.message, matchedKey.id);
      
      return res.status(401).json(errorData);
    }
    
    // Update last used timestamp (fire and forget, don't block request)
    storage.updateApiKeyLastUsed(matchedKey.id).catch(err => {
      console.error("Failed to update API key last used:", err);
    });
    
    // Log successful authentication
    storage.createAuditLog({
      actorId: null,
      action: "external_api_auth_success",
      resource: "api_key",
      resourceId: matchedKey.id,
      before: null,
      after: {
        endpoint: req.path,
        method: req.method,
        apiKeyName: matchedKey.name,
        timestamp: new Date().toISOString(),
      },
      ipAddress: req.ip || req.connection.remoteAddress || null,
      userAgent: req.headers["user-agent"] || null,
    }).catch(err => {
      console.error("[API-AUTH] Failed to log auth success:", err);
    });
    
    // Attach API key info to request
    req.apiKey = {
      id: matchedKey.id,
      name: matchedKey.name,
      description: matchedKey.description,
      rateLimitPerMin: matchedKey.rateLimitPerMin,
    };
    
    next();
  } catch (error) {
    console.error("[API-AUTH] Authentication error:", error);
    
    // Log internal authentication error (fire-and-forget)
    logAuthFailure(
      req,
      500,
      "Authentication error",
      error instanceof Error ? error.message : "Unknown error"
    );
    
    return res.status(500).json({
      error: "Authentication error",
      message: "An error occurred during authentication"
    });
  }
}

/**
 * Create rate limiter middleware for external API
 * Uses per-key rate limiting based on API key configuration
 */
export function createApiKeyRateLimiter() {
  return rateLimit({
    windowMs: 60 * 1000, // 1 minute window
    max: async (req: ApiKeyRequest) => {
      // Use per-key rate limit if configured, otherwise default to 100 req/min
      return req.apiKey?.rateLimitPerMin || 100;
    },
    // Use API key ID as identifier for rate limiting (not IP-based)
    keyGenerator: (req: ApiKeyRequest) => {
      // Always use API key ID as the rate limit key
      // This ensures proper per-key limits regardless of IP
      return req.apiKey?.id || "unknown";
    },
    standardHeaders: true, // Return rate limit info in headers
    legacyHeaders: false,  // Disable X-RateLimit-* headers
    message: {
      error: "Too many requests",
      message: "You have exceeded the rate limit for this API key. Please try again later.",
    },
    // Skip failed requests (don't count them against the limit)
    skipFailedRequests: false,
    skipSuccessfulRequests: false,
  });
}
