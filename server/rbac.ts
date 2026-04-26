// Custom RBAC (Role-Based Access Control) middleware
// Independent from Replit security framework
// Deny-by-default permission model

import { Request, Response, NextFunction } from "express";
import { storage } from "./db";
import type { AuthRequest } from "./auth";

// Permission cache to avoid repeated database queries
const permissionCache = new Map<string, Set<string>>();

// Entity resources that require an active org context
const ENTITY_RESOURCES = new Set([
  "Account", "Contact", "Lead", "Opportunity", "Activity",
  "ResourceAllocation", "Comment",
]);

// Resolve which roles to use for permission checking.
// When orgId is set: Global Admins use global roles; everyone else uses ONLY their org-effective role.
// When orgId is not set: use global roles (legacy / admin-only paths).
async function resolveEffectiveRoles(userId: string, orgId?: string) {
  const globalRoles = await storage.getUserRoles(userId);
  const isGlobalAdmin = globalRoles.some(r => r.name === "Admin");

  if (!orgId || isGlobalAdmin) {
    return globalRoles;
  }

  // Non-admin with org context: use ONLY the org-effective role.
  // This prevents global non-admin roles from granting permissions inside an org.
  const membership = await storage.getOrgMembership(userId, orgId);
  if (!membership) return [];

  const allRoles = await storage.getAllRoles();
  const orgRole = allRoles.find(r => r.name === membership.roleName);
  return orgRole ? [orgRole] : [];
}

// Get user permissions (with caching)
async function getUserPermissions(userId: string, orgId?: string): Promise<Set<string>> {
  const cacheKey = orgId ? `${userId}:${orgId}` : userId;
  if (permissionCache.has(cacheKey)) {
    return permissionCache.get(cacheKey)!;
  }

  const roles = await resolveEffectiveRoles(userId, orgId);

  const permissionSets = await Promise.all(
    roles.map(role => storage.getRolePermissions(role.id))
  );

  const permissions = new Set<string>();
  permissionSets.flat().forEach(p => {
    permissions.add(`${p.resource}.${p.action}`);
  });

  permissionCache.set(cacheKey, permissions);
  setTimeout(() => permissionCache.delete(cacheKey), 5 * 60 * 1000);

  return permissions;
}

// Clear permission cache for a user (evicts all org-scoped entries too)
export function clearPermissionCache(userId: string) {
  Array.from(permissionCache.keys()).forEach(key => {
    if (key === userId || key.startsWith(`${userId}:`)) {
      permissionCache.delete(key);
    }
  });
}

// Check if user has permission, using org-effective roles when orgId is provided
export async function hasPermission(userId: string, resource: string, action: string, orgId?: string): Promise<boolean> {
  const permissions = await getUserPermissions(userId, orgId);

  if (permissions.has(`${resource}.${action}`)) return true;
  if (permissions.has(`${resource}.*`) || permissions.has(`*.${action}`) || permissions.has(`*.*`)) return true;

  return false;
}

// Check if user has any of the specified roles.
// In org context, uses only the org-effective role (global Admin bypasses this).
export async function hasAnyRole(userId: string, roleNames: string[], orgId?: string): Promise<boolean> {
  const effectiveRoles = await resolveEffectiveRoles(userId, orgId);
  return effectiveRoles.some(role => roleNames.includes(role.name));
}

// Verify org membership for the active org (reused by both requirePermission and requireRole)
// Global Admins always pass. Others must be members of req.activeOrgId.
async function enforceOrgMembership(req: AuthRequest, res: Response): Promise<boolean> {
  if (!req.activeOrgId) {
    res.status(400).json({ error: "Active organization context required. Set X-Organization-Id header." });
    return false;
  }
  const isGlobalAdmin = await hasAnyRole(req.user!.id, ["Admin"]);
  if (isGlobalAdmin) return true;

  const membership = await storage.getOrgMembership(req.user!.id, req.activeOrgId);
  if (!membership) {
    res.status(403).json({ error: "You are not a member of this organization" });
    return false;
  }
  return true;
}

// Middleware to require specific permission with org-membership enforcement for entity resources
export function requirePermission(resource: string, action: string) {
  return async (req: AuthRequest, res: Response, next: NextFunction) => {
    if (!req.user) {
      return res.status(401).json({ error: "Authentication required" });
    }

    // Entity resources require a validated org context
    if (ENTITY_RESOURCES.has(resource)) {
      const ok = await enforceOrgMembership(req, res);
      if (!ok) return;
    }

    const allowed = await hasPermission(req.user.id, resource, action, req.activeOrgId || undefined);

    if (!allowed) {
      return res.status(403).json({
        error: "Forbidden",
        message: `You do not have permission to ${action} ${resource}`
      });
    }

    next();
  };
}

// Middleware to require specific role with org-membership enforcement.
// Tenant-scoped routes must always supply an active org context.
export function requireRole(...roleNames: string[]) {
  return async (req: AuthRequest, res: Response, next: NextFunction) => {
    if (!req.user) {
      return res.status(401).json({ error: "Authentication required" });
    }

    // Always enforce org membership — rejects requests missing X-Organization-Id
    const ok = await enforceOrgMembership(req, res);
    if (!ok) return;

    const allowed = await hasAnyRole(req.user.id, roleNames, req.activeOrgId);

    if (!allowed) {
      return res.status(403).json({
        error: "Forbidden",
        message: `You must have one of these roles: ${roleNames.join(", ")}`
      });
    }

    next();
  };
}

// Middleware to require a GLOBAL role — does not check org-level roles.
// Use this for system-administration routes that must only be accessible
// by users who hold the role globally, regardless of any active org context.
export function requireGlobalRole(...roleNames: string[]) {
  return async (req: AuthRequest, res: Response, next: NextFunction) => {
    if (!req.user) {
      return res.status(401).json({ error: "Authentication required" });
    }
    const globalRoles = await storage.getUserRoles(req.user.id);
    const allowed = globalRoles.some(r => roleNames.includes(r.name));
    if (!allowed) {
      return res.status(403).json({
        error: "Forbidden",
        message: `You must have one of these global roles: ${roleNames.join(", ")}`
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

    if (existingRoles.length === 0) {
      console.log("Initializing default roles and permissions...");
      const { seedRolesAndPermissions } = await import("./seed");
      await seedRolesAndPermissions();
      console.log("✓ Default roles and permissions initialized successfully");
    } else {
      console.log("Roles already initialized");
      const { ensureProductDeveloperRole, ensureResourceRole, ensureLeadGenRoles } = await import("./seed");
      await ensureProductDeveloperRole();
      await ensureResourceRole();
      await ensureLeadGenRoles();
    }

  } catch (error) {
    console.error("Error initializing roles and permissions:", error);
  }
}
