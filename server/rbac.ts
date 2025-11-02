// Custom RBAC (Role-Based Access Control) middleware
// Independent from Replit security framework
// Deny-by-default permission model

import { Request, Response, NextFunction } from "express";
import { storage } from "./db";
import type { AuthRequest } from "./auth";
import type { Permission } from "@shared/schema";

// Permission cache to avoid repeated database queries
const permissionCache = new Map<string, Set<string>>();

// Get user permissions (with caching)
async function getUserPermissions(userId: string): Promise<Set<string>> {
  // Check cache first
  if (permissionCache.has(userId)) {
    return permissionCache.get(userId)!;
  }
  
  // Get user roles
  const roles = await storage.getUserRoles(userId);
  
  // Get all permissions for these roles
  const permissionSets = await Promise.all(
    roles.map(role => storage.getRolePermissions(role.id))
  );
  
  // Flatten and create set of permission strings (resource.action)
  const permissions = new Set<string>();
  permissionSets.flat().forEach(p => {
    permissions.add(`${p.resource}.${p.action}`);
  });
  
  // Cache for 5 minutes
  permissionCache.set(userId, permissions);
  setTimeout(() => permissionCache.delete(userId), 5 * 60 * 1000);
  
  return permissions;
}

// Clear permission cache for a user
export function clearPermissionCache(userId: string) {
  permissionCache.delete(userId);
}

// Check if user has permission
export async function hasPermission(userId: string, resource: string, action: string): Promise<boolean> {
  const permissions = await getUserPermissions(userId);
  
  // Check for specific permission
  if (permissions.has(`${resource}.${action}`)) {
    return true;
  }
  
  // Check for wildcard permissions
  if (permissions.has(`${resource}.*`) || permissions.has(`*.${action}`) || permissions.has(`*.*`)) {
    return true;
  }
  
  return false;
}

// Middleware to require specific permission
export function requirePermission(resource: string, action: string) {
  return async (req: AuthRequest, res: Response, next: NextFunction) => {
    if (!req.user) {
      return res.status(401).json({ error: "Authentication required" });
    }
    
    const allowed = await hasPermission(req.user.id, resource, action);
    
    if (!allowed) {
      return res.status(403).json({ 
        error: "Forbidden",
        message: `You do not have permission to ${action} ${resource}`
      });
    }
    
    next();
  };
}

// Check if user has any of the specified roles
export async function hasAnyRole(userId: string, roleNames: string[]): Promise<boolean> {
  const roles = await storage.getUserRoles(userId);
  return roles.some(role => roleNames.includes(role.name));
}

// Middleware to require specific role
export function requireRole(...roleNames: string[]) {
  return async (req: AuthRequest, res: Response, next: NextFunction) => {
    if (!req.user) {
      return res.status(401).json({ error: "Authentication required" });
    }
    
    const allowed = await hasAnyRole(req.user.id, roleNames);
    
    if (!allowed) {
      return res.status(403).json({ 
        error: "Forbidden",
        message: `You must have one of these roles: ${roleNames.join(", ")}`
      });
    }
    
    next();
  };
}

// Default role assignments for new users
export const DEFAULT_ROLE = "SalesRep";

// Initialize default roles and permissions
export async function initializeDefaultRolesAndPermissions() {
  try {
    const existingRoles = await storage.getAllRoles();
    
    // Only initialize if no roles exist
    if (existingRoles.length > 0) {
      console.log("Roles already initialized");
      return;
    }
    
    console.log("Initializing default roles and permissions...");
    
    // Import and run the seed script
    const { seedRolesAndPermissions } = await import("./seed");
    await seedRolesAndPermissions();
    
    console.log("✓ Default roles and permissions initialized successfully");
    
  } catch (error) {
    console.error("Error initializing roles and permissions:", error);
    // Don't throw - allow the app to start even if seeding fails
    // Users can manually run the seed script if needed
  }
}
