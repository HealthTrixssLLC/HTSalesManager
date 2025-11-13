// API Key authentication middleware
// For external integrations and forecasting app access

import { Request, Response, NextFunction } from "express";
import { storage } from "./db";
import { verifyApiKey, validateApiKeyFormat } from "./api-key-utils";

export interface ApiKeyRequest extends Request {
  apiKey?: {
    id: string;
    name: string;
    description: string | null;
  };
}

/**
 * Middleware to authenticate requests using API keys
 * Checks x-api-key header, validates format, verifies against database
 * Updates lastUsedAt timestamp on successful auth
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
      return res.status(401).json({
        error: "API key required",
        message: "Please provide your API key in the x-api-key header"
      });
    }
    
    // Validate format
    if (!validateApiKeyFormat(providedKey)) {
      return res.status(401).json({
        error: "Invalid API key format",
        message: "The provided API key format is invalid"
      });
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
      return res.status(401).json({
        error: "Invalid API key",
        message: "The provided API key is invalid or has been revoked"
      });
    }
    
    // Check if key has expired
    if (matchedKey.expiresAt && new Date(matchedKey.expiresAt) < new Date()) {
      return res.status(401).json({
        error: "API key expired",
        message: "The provided API key has expired"
      });
    }
    
    // Update last used timestamp (fire and forget, don't block request)
    storage.updateApiKeyLastUsed(matchedKey.id).catch(err => {
      console.error("Failed to update API key last used:", err);
    });
    
    // Attach API key info to request
    req.apiKey = {
      id: matchedKey.id,
      name: matchedKey.name,
      description: matchedKey.description,
    };
    
    next();
  } catch (error) {
    console.error("API key authentication error:", error);
    return res.status(500).json({
      error: "Authentication error",
      message: "An error occurred during authentication"
    });
  }
}
