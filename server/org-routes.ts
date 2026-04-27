// Organization management routes for multi-tenant support

import type { Express, Response, NextFunction } from "express";
import { z } from "zod";
import { storage } from "./db";
import { authenticate, type AuthRequest } from "./auth";
import { requireRole, requireGlobalRole, hasAnyRole } from "./rbac";
import { sensitiveRateLimiter, readRateLimiter, crudRateLimiter } from "./rate-limiters";
import { initializeOrgSettings } from "./seed";

// Middleware: require that the authenticated user is an Admin for the target org (:id param)
// Falls through to global Admin check too (via hasAnyRole)
async function requireOrgAdmin(req: AuthRequest, res: Response, next: NextFunction) {
  if (!req.user) return res.status(401).json({ error: "Authentication required" });
  const targetOrgId = req.params.id;
  // Check global Admin OR org-specific Admin for the target org
  const allowed = await hasAnyRole(req.user.id, ["Admin"], targetOrgId);
  if (!allowed) {
    return res.status(403).json({ error: "You must be an Admin for this organization" });
  }
  next();
}

export function registerOrgRoutes(app: Express) {
  // GET /api/organizations — list orgs the current user belongs to
  app.get("/api/organizations", authenticate, readRateLimiter, async (req: AuthRequest, res) => {
    try {
      const userOrgs = await storage.getUserOrganizations(req.user!.id);
      return res.json(userOrgs);
    } catch (error) {
      console.error("Failed to fetch user organizations:", error);
      return res.status(500).json({ error: "Failed to fetch organizations" });
    }
  });

  // GET /api/organizations/all — list ALL orgs (admin only)
  app.get("/api/organizations/all", authenticate, requireGlobalRole("Admin"), readRateLimiter, async (req: AuthRequest, res) => {
    try {
      const orgs = await storage.getAllOrganizations();
      return res.json(orgs);
    } catch (error) {
      return res.status(500).json({ error: "Failed to fetch organizations" });
    }
  });

  // POST /api/organizations — create org (admin only)
  app.post("/api/organizations", authenticate, requireGlobalRole("Admin"), crudRateLimiter, async (req: AuthRequest, res) => {
    try {
      const schema = z.object({
        name: z.string().min(1),
        slug: z.string().min(1).regex(/^[a-z0-9-]+$/),
        description: z.string().nullish().transform(val => val ?? undefined),
        logoUrl: z.string().optional().nullable().transform(val => (val === null || val === "") ? undefined : val),
        settings: z.record(z.any()).optional().default({}),
      });
      const data = schema.parse(req.body);
      const org = await storage.createOrganization(data);
      // Initialize org-specific settings (ID patterns, account categories) for the new org
      await initializeOrgSettings(org.id).catch(e =>
        console.error(`Failed to initialize settings for org ${org.id}:`, e)
      );
      return res.json(org);
    } catch (error) {
      if (error instanceof z.ZodError) {
        return res.status(400).json({ error: "Validation failed", details: error.errors });
      }
      return res.status(500).json({ error: "Failed to create organization" });
    }
  });

  // PUT /api/organizations/:id — update org (must be Admin of that specific org or global Admin)
  app.put("/api/organizations/:id", authenticate, requireOrgAdmin, crudRateLimiter, async (req: AuthRequest, res) => {
    try {
      const schema = z.object({
        name: z.string().min(1).optional(),
        slug: z.string().min(1).regex(/^[a-z0-9-]+$/).optional(),
        description: z.string().optional().nullable(),
        logoUrl: z.string().optional().nullable(),
        settings: z.record(z.any()).optional(),
      });
      const data = schema.parse(req.body);
      const org = await storage.updateOrganization(req.params.id, data);
      if (!org) return res.status(404).json({ error: "Organization not found" });
      return res.json(org);
    } catch (error) {
      if (error instanceof z.ZodError) {
        return res.status(400).json({ error: "Validation failed", details: error.errors });
      }
      return res.status(500).json({ error: "Failed to update organization" });
    }
  });

  // DELETE /api/organizations/:id — delete org (must be global Admin only — not delegated)
  app.delete("/api/organizations/:id", authenticate, requireGlobalRole("Admin"), sensitiveRateLimiter, async (req: AuthRequest, res) => {
    try {
      await storage.deleteOrganization(req.params.id);
      return res.json({ success: true });
    } catch (error) {
      return res.status(500).json({ error: "Failed to delete organization" });
    }
  });

  // GET /api/organizations/:id/members — list org members (must be Admin of that org)
  app.get("/api/organizations/:id/members", authenticate, requireOrgAdmin, readRateLimiter, async (req: AuthRequest, res) => {
    try {
      const members = await storage.getOrganizationMembers(req.params.id);
      return res.json(members);
    } catch (error) {
      return res.status(500).json({ error: "Failed to fetch organization members" });
    }
  });

  // POST /api/organizations/:id/members — add member (must be Admin of that org)
  app.post("/api/organizations/:id/members", authenticate, requireOrgAdmin, crudRateLimiter, async (req: AuthRequest, res) => {
    try {
      const schema = z.object({
        userId: z.string().min(1),
        roleId: z.string().min(1),
        isDefault: z.boolean().optional().default(false),
      });
      const data = schema.parse(req.body);
      const member = await storage.addOrganizationMember({
        userId: data.userId,
        organizationId: req.params.id,
        roleId: data.roleId,
        isDefault: data.isDefault,
      });
      return res.json(member);
    } catch (error) {
      if (error instanceof z.ZodError) {
        return res.status(400).json({ error: "Validation failed", details: error.errors });
      }
      const msg = error instanceof Error ? error.message : String(error);
      if (msg.includes("unique") || msg.includes("duplicate")) {
        return res.status(409).json({ error: "User is already a member of this organization" });
      }
      return res.status(500).json({ error: "Failed to add member" });
    }
  });

  // PUT /api/organizations/:id/members/:userId — change member role (must be Admin of that org)
  app.put("/api/organizations/:id/members/:userId", authenticate, requireOrgAdmin, crudRateLimiter, async (req: AuthRequest, res) => {
    try {
      const schema = z.object({ roleId: z.string().min(1) });
      const { roleId } = schema.parse(req.body);
      const member = await storage.updateOrganizationMember(req.params.userId, req.params.id, roleId);
      return res.json(member);
    } catch (error) {
      return res.status(500).json({ error: "Failed to update member role" });
    }
  });

  // DELETE /api/organizations/:id/members/:userId — remove member (must be Admin of that org)
  app.delete("/api/organizations/:id/members/:userId", authenticate, requireOrgAdmin, crudRateLimiter, async (req: AuthRequest, res) => {
    try {
      await storage.removeOrganizationMember(req.params.userId, req.params.id);
      return res.json({ success: true });
    } catch (error) {
      return res.status(500).json({ error: "Failed to remove member" });
    }
  });

  // PUT /api/user/default-org — set current user's default org
  app.put("/api/user/default-org", authenticate, crudRateLimiter, async (req: AuthRequest, res) => {
    try {
      const schema = z.object({ organizationId: z.string().min(1) });
      const { organizationId } = schema.parse(req.body);

      // Verify user is a member of this org
      const userOrgs = await storage.getUserOrganizations(req.user!.id);
      const isMember = userOrgs.some(o => o.organizationId === organizationId);
      if (!isMember) {
        return res.status(403).json({ error: "You are not a member of this organization" });
      }

      await storage.setDefaultOrganization(req.user!.id, organizationId);
      return res.json({ success: true });
    } catch (error) {
      if (error instanceof z.ZodError) {
        return res.status(400).json({ error: "Validation failed", details: error.errors });
      }
      return res.status(500).json({ error: "Failed to set default organization" });
    }
  });

  // POST /api/organizations/:id/bulk-assign-data — reassign all CRM entities to this org (admin only)
  app.post("/api/organizations/:id/bulk-assign-data", authenticate, requireGlobalRole("Admin"), crudRateLimiter, async (req: AuthRequest, res) => {
    try {
      const schema_v = z.object({
        sourceOrgId: z.string().min(1),
      });
      const { sourceOrgId } = schema_v.parse(req.body);
      const targetOrgId = req.params.id;

      if (sourceOrgId !== "all") {
        const sourceOrg = await storage.getOrganizationById(sourceOrgId);
        if (!sourceOrg) return res.status(404).json({ error: "Source organization not found" });
      }
      const targetOrg = await storage.getOrganizationById(targetOrgId);
      if (!targetOrg) return res.status(404).json({ error: "Target organization not found" });
      if (sourceOrgId !== "all" && sourceOrgId === targetOrgId) {
        return res.status(400).json({ error: "Source and target organizations must be different" });
      }

      const result = await storage.bulkAssignData(targetOrgId, sourceOrgId);
      return res.json({ success: true, moved: result });
    } catch (error) {
      if (error instanceof z.ZodError) {
        return res.status(400).json({ error: "Validation failed", details: error.errors });
      }
      console.error("Bulk assign error:", error);
      return res.status(500).json({ error: "Failed to bulk assign data" });
    }
  });

  // GET /api/user/organizations — current user's organizations (alias)
  app.get("/api/user/organizations", authenticate, readRateLimiter, async (req: AuthRequest, res) => {
    try {
      const userOrgs = await storage.getUserOrganizations(req.user!.id);
      return res.json(userOrgs);
    } catch (error) {
      return res.status(500).json({ error: "Failed to fetch user organizations" });
    }
  });
}
