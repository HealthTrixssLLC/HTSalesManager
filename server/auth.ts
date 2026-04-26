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
  activeOrgId?: string;
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

              // Enforce API key org scope:
              // If the key is org-scoped (key.organizationId is set), the request must
              // target that exact org — cross-org access is rejected.
              if (key.organizationId) {
                if (req.activeOrgId && req.activeOrgId !== key.organizationId) {
                  return res.status(403).json({ error: "API key does not belong to the specified organization" });
                }
                // Pin the request to the key's org (even if no X-Organization-Id header was sent)
                req.activeOrgId = key.organizationId;
              } else {
                // System-level key (no org): fall back to request header or user's default org
                if (!req.activeOrgId) {
                  const userOrgs = await storage.getUserOrganizations(user.id);
                  const defaultOrg = userOrgs.find(o => o.isDefault === true) || userOrgs[0];
                  if (defaultOrg) req.activeOrgId = defaultOrg.organizationId;
                }
              }

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

    // Resolve and validate active org
    const userOrgs = await storage.getUserOrganizations(user.id);

    if (req.activeOrgId) {
      // An explicit org header was provided — verify the user is a member
      const isMember = userOrgs.some(o => o.organizationId === req.activeOrgId);
      if (!isMember) {
        // Global admins may access any org without being a member
        const globalRoles = await storage.getUserRoles(user.id);
        const isGlobalAdmin = globalRoles.some(r => r.name === "Admin");
        if (!isGlobalAdmin) {
          return res.status(403).json({ error: "Access denied: not a member of the specified organization" });
        }
      }
    } else {
      // No org header — resolve the user's default org
      const defaultOrg = userOrgs.find(o => o.isDefault === true) || userOrgs[0];
      if (defaultOrg) {
        req.activeOrgId = defaultOrg.organizationId;
      }
    }

    next();
  } catch (error) {
    return res.status(401).json({ error: "Invalid or expired token" });
  }
}

// Middleware to attach active org ID from request header
export function attachActiveOrg(req: AuthRequest, res: Response, next: NextFunction) {
  const orgId = req.headers["x-organization-id"] as string | undefined;
  if (orgId) {
    req.activeOrgId = orgId;
  }
  next();
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
