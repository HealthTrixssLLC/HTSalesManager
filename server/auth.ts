// Custom authentication system with JWT and bcrypt
// Independent from Replit Auth as per requirements

import { Request, Response, NextFunction } from "express";
import jwt from "jsonwebtoken";
import bcrypt from "bcryptjs";
import { storage } from "./db";
import type { User } from "@shared/schema";

const JWT_SECRET = process.env.SESSION_SECRET || "health-trixss-crm-secret-key";
const SALT_ROUNDS = 10;

export interface AuthRequest extends Request {
  user?: User;
}

// Hash password
export async function hashPassword(password: string): Promise<string> {
  return await bcrypt.hash(password, SALT_ROUNDS);
}

// Verify password
export async function verifyPassword(password: string, hash: string): Promise<boolean> {
  return await bcrypt.compare(password, hash);
}

// Generate JWT token
export function generateToken(user: User): string {
  return jwt.sign({ id: user.id, email: user.email }, JWT_SECRET, { expiresIn: "7d" });
}

// Verify JWT token and attach user to request
export async function authenticate(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    // Check for API key authentication first (for MCP server and external integrations)
    const apiKeyHeader = req.headers["x-api-key"] as string | undefined;
    if (apiKeyHeader) {
      const { validateApiKeyFormat, verifyApiKey } = await import("./api-key-utils");
      if (validateApiKeyFormat(apiKeyHeader)) {
        const apiKeys = await storage.getAllApiKeys();
        const activeKeys = apiKeys.filter(k => k.isActive && !k.revokedAt);
        for (const key of activeKeys) {
          if (key.expiresAt && new Date(key.expiresAt) < new Date()) continue;
          const isValid = await verifyApiKey(apiKeyHeader, key.hashedKey);
          if (isValid) {
            const user = await storage.getUserById(key.createdBy);
            if (user) {
              req.user = user;
              storage.updateApiKeyLastUsed(key.id).catch(() => {});
              return next();
            }
          }
        }
      }
      return res.status(401).json({ error: "Invalid or expired API key" });
    }

    const token = req.headers.authorization?.replace("Bearer ", "") || req.cookies?.token;
    
    if (!token) {
      return res.status(401).json({ error: "Authentication required" });
    }
    
    const decoded = jwt.verify(token, JWT_SECRET) as { id: string; email: string };
    const user = await storage.getUserById(decoded.id);
    
    if (!user) {
      return res.status(401).json({ error: "User not found" });
    }
    
    req.user = user;
    next();
  } catch (error) {
    return res.status(401).json({ error: "Invalid or expired token" });
  }
}

// Optional authentication (doesn't fail if no token)
export async function optionalAuthenticate(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const token = req.headers.authorization?.replace("Bearer ", "") || req.cookies?.token;
    
    if (token) {
      const decoded = jwt.verify(token, JWT_SECRET) as { id: string; email: string };
      const user = await storage.getUserById(decoded.id);
      if (user) {
        req.user = user;
      }
    }
  } catch (error) {
    // Ignore errors for optional authentication
  }
  next();
}
