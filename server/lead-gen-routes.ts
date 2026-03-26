// Lead Generation Module API Routes
// All routes under /api/lead-gen/...

import type { Express } from "express";
import { z } from "zod";
import { db, storage, eq, and, sql, desc, inArray } from "./db";
import { lt, ne, or } from "drizzle-orm";
import type { SQL } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import type { NeonDatabase } from "drizzle-orm/neon-serverless";
import { authenticate, type AuthRequest } from "./auth";

import { requireRole } from "./rbac";
import { crudRateLimiter, readRateLimiter } from "./rate-limiters";
import * as schema from "@shared/schema";
import {
  insertIcpProfileSchema,
  insertIcpProfileVersionSchema,
  insertOfferSchema,
  insertTaskPlaybookSchema,
  insertTaskPlaybookStepSchema,
  insertLeadGenerationRunSchema,
  insertCandidateAccountSchema,
  insertCandidateContactSchema,
  insertCandidateLeadSchema,
  insertCandidateScoreSchema,
  insertEvidenceSourceSchema,
  insertAiConfigSchema,
  researchDocuments,
  type ResearchDocument,
} from "@shared/schema";
import { runLeadGenPipeline } from "./lead-gen-agent-service";

type TypedPgDb = NodePgDatabase<typeof schema> | NeonDatabase<typeof schema>;

type CandidateQueryRow = {
  candidate: schema.CandidateLead;
  account: schema.CandidateAccount | null;
  contact: schema.CandidateContact | null;
  score: { totalScore: number; maxScore: number } | null;
  run: schema.LeadGenerationRun | null;
};

async function createLgAudit(
  actorId: string | undefined,
  eventType: string,
  entityType: string,
  entityId: string | null,
  runId: string | null,
  details: Record<string, unknown>,
) {
  try {
    await db.insert(schema.lgAuditEvents).values({
      actorId: actorId || null,
      eventType,
      entityType,
      entityId,
      runId,
      details: details || {},
    });
  } catch (err) {
    console.error("LG audit error:", err);
  }
}

async function createAuditLog(
  actorId: string | undefined,
  action: string,
  resource: string,
  resourceId: string | null,
  before: Record<string, unknown> | null,
  after: Record<string, unknown> | null,
  req: { ip?: string; headers?: Record<string, string | string[] | undefined> },
) {
  try {
    await storage.createAuditLog({
      actorId: actorId || null,
      action,
      resource,
      resourceId,
      before,
      after,
      ipAddress: req.ip || null,
      userAgent: (req.headers?.["user-agent"] as string) || null,
    });
  } catch (err) {
    console.error("Audit log error:", err);
  }
}

export function registerLeadGenRoutes(app: Express) {


  app.get("/api/lead-gen/icps", authenticate, requireRole("Admin", "SalesManager", "SalesRep", "ReadOnly", "SalesOperator", "Reviewer"), readRateLimiter, async (req: AuthRequest, res) => {
    try {
      const profiles = await db.select().from(schema.icpProfiles).orderBy(desc(schema.icpProfiles.createdAt));
      return res.json(profiles);
    } catch (err) {
      console.error(err);
      return res.status(500).json({ error: "Failed to fetch ICP profiles" });
    }
  });

  app.get("/api/lead-gen/icps/:id", authenticate, requireRole("Admin", "SalesManager", "SalesRep", "ReadOnly", "SalesOperator", "Reviewer"), readRateLimiter, async (req: AuthRequest, res) => {
    try {
      const profile = await db.select().from(schema.icpProfiles).where(eq(schema.icpProfiles.id, req.params.id)).limit(1);
      if (!profile[0]) return res.status(404).json({ error: "ICP profile not found" });

      const versions = await db.select().from(schema.icpProfileVersions)
        .where(eq(schema.icpProfileVersions.icpProfileId, req.params.id))
        .orderBy(desc(schema.icpProfileVersions.versionNumber));

      const offersData = await db.select().from(schema.offers)
        .where(eq(schema.offers.icpProfileId, req.params.id));

      const playbooks = await db.select().from(schema.taskPlaybooks)
        .where(eq(schema.taskPlaybooks.icpProfileId, req.params.id));

      return res.json({ ...profile[0], versions, offers: offersData, playbooks });
    } catch (err) {
      console.error(err);
      return res.status(500).json({ error: "Failed to fetch ICP profile" });
    }
  });

  app.post("/api/lead-gen/icps", authenticate, requireRole("Admin", "SalesManager"), crudRateLimiter, async (req: AuthRequest, res) => {
    try {
      const data = insertIcpProfileSchema.parse({ ...req.body, createdBy: req.user?.id });
      const result = await db.insert(schema.icpProfiles).values(data).returning();
      await createLgAudit(req.user?.id, "icp_profile_created", "IcpProfile", result[0].id, null, result[0]);
      await createAuditLog(req.user?.id, "create", "IcpProfile", result[0].id, null, result[0] as unknown as Record<string, unknown>, req);
      return res.json(result[0]);
    } catch (err) {
      if (err instanceof z.ZodError) return res.status(400).json({ error: "Validation failed", details: err.errors });
      return res.status(500).json({ error: "Failed to create ICP profile" });
    }
  });

  const icpPatchSchema = z.object({
    name: z.string().min(1).optional(),
    description: z.string().optional().nullable(),
    isActive: z.boolean().optional(),
  });

  app.patch("/api/lead-gen/icps/:id", authenticate, requireRole("Admin", "SalesManager"), crudRateLimiter, async (req: AuthRequest, res) => {
    try {
      const parsed = icpPatchSchema.safeParse(req.body);
      if (!parsed.success) return res.status(400).json({ error: "Invalid fields", details: parsed.error.errors });
      const before = await db.select().from(schema.icpProfiles).where(eq(schema.icpProfiles.id, req.params.id)).limit(1);
      if (!before[0]) return res.status(404).json({ error: "ICP profile not found" });
      const result = await db.update(schema.icpProfiles)
        .set({ ...parsed.data, updatedAt: new Date() })
        .where(eq(schema.icpProfiles.id, req.params.id))
        .returning();
      await createLgAudit(req.user?.id, "icp_profile_updated", "IcpProfile", req.params.id, null, result[0]);
      await createAuditLog(req.user?.id, "update", "IcpProfile", req.params.id, before[0] as unknown as Record<string, unknown>, result[0] as unknown as Record<string, unknown>, req);
      return res.json(result[0]);
    } catch (err) {
      return res.status(500).json({ error: "Failed to update ICP profile" });
    }
  });

  app.delete("/api/lead-gen/icps/:id", authenticate, requireRole("Admin", "SalesManager"), crudRateLimiter, async (req: AuthRequest, res) => {
    try {
      const toDelete = await db.select().from(schema.icpProfiles).where(eq(schema.icpProfiles.id, req.params.id)).limit(1);
      await db.delete(schema.icpProfiles).where(eq(schema.icpProfiles.id, req.params.id));
      if (toDelete[0]) await createAuditLog(req.user?.id, "delete", "IcpProfile", req.params.id, toDelete[0] as unknown as Record<string, unknown>, null, req);
      return res.json({ success: true });
    } catch (err) {
      return res.status(500).json({ error: "Failed to delete ICP profile" });
    }
  });


  app.get("/api/lead-gen/icps/:id/versions", authenticate, requireRole("Admin", "SalesManager", "SalesRep", "ReadOnly", "SalesOperator", "Reviewer"), readRateLimiter, async (req: AuthRequest, res) => {
    try {
      const versions = await db.select().from(schema.icpProfileVersions)
        .where(eq(schema.icpProfileVersions.icpProfileId, req.params.id))
        .orderBy(desc(schema.icpProfileVersions.versionNumber));
      return res.json(versions);
    } catch (err) {
      return res.status(500).json({ error: "Failed to fetch versions" });
    }
  });

  app.post("/api/lead-gen/icps/:id/versions", authenticate, requireRole("Admin", "SalesManager"), crudRateLimiter, async (req: AuthRequest, res) => {
    try {
      const existing = await db.select({ maxVer: sql<number>`max(version_number)` })
        .from(schema.icpProfileVersions)
        .where(eq(schema.icpProfileVersions.icpProfileId, req.params.id));
      const nextVersion = (existing[0]?.maxVer || 0) + 1;

      const data = insertIcpProfileVersionSchema.parse({
        ...req.body,
        icpProfileId: req.params.id,
        versionNumber: nextVersion,
        createdBy: req.user?.id,
      });
      const result = await db.insert(schema.icpProfileVersions).values(data).returning();
      await createLgAudit(req.user?.id, "icp_version_created", "IcpProfileVersion", result[0].id, null, result[0]);
      await createAuditLog(req.user?.id, "create", "IcpProfileVersion", result[0].id, null, result[0] as unknown as Record<string, unknown>, req);
      return res.json(result[0]);
    } catch (err) {
      if (err instanceof z.ZodError) return res.status(400).json({ error: "Validation failed", details: err.errors });
      return res.status(500).json({ error: "Failed to create ICP version" });
    }
  });


  app.get("/api/lead-gen/icps/:id/offers", authenticate, requireRole("Admin", "SalesManager", "SalesRep", "ReadOnly", "SalesOperator", "Reviewer"), readRateLimiter, async (req: AuthRequest, res) => {
    try {
      const offersData = await db.select().from(schema.offers)
        .where(eq(schema.offers.icpProfileId, req.params.id));
      return res.json(offersData);
    } catch (err) {
      return res.status(500).json({ error: "Failed to fetch offers" });
    }
  });

  app.post("/api/lead-gen/icps/:id/offers", authenticate, requireRole("Admin", "SalesManager"), crudRateLimiter, async (req: AuthRequest, res) => {
    try {
      const data = insertOfferSchema.parse({ ...req.body, icpProfileId: req.params.id, createdBy: req.user?.id });
      const result = await db.insert(schema.offers).values(data).returning();
      await createAuditLog(req.user?.id, "create", "Offer", result[0].id, null, result[0] as unknown as Record<string, unknown>, req);
      return res.json(result[0]);
    } catch (err) {
      if (err instanceof z.ZodError) return res.status(400).json({ error: "Validation failed", details: err.errors });
      return res.status(500).json({ error: "Failed to create offer" });
    }
  });

  const offerPatchSchema = z.object({
    name: z.string().min(1).optional(),
    description: z.string().optional().nullable(),
    valueProposition: z.string().optional().nullable(),
    isActive: z.boolean().optional(),
  });

  app.patch("/api/lead-gen/offers/:id", authenticate, requireRole("Admin", "SalesManager"), crudRateLimiter, async (req: AuthRequest, res) => {
    try {
      const parsed = offerPatchSchema.safeParse(req.body);
      if (!parsed.success) return res.status(400).json({ error: "Invalid fields", details: parsed.error.errors });
      const result = await db.update(schema.offers)
        .set({ ...parsed.data, updatedAt: new Date() })
        .where(eq(schema.offers.id, req.params.id))
        .returning();
      if (!result[0]) return res.status(404).json({ error: "Offer not found" });
      await createAuditLog(req.user?.id, "update", "Offer", req.params.id, null, result[0] as unknown as Record<string, unknown>, req);
      return res.json(result[0]);
    } catch (err) {
      return res.status(500).json({ error: "Failed to update offer" });
    }
  });

  app.delete("/api/lead-gen/offers/:id", authenticate, requireRole("Admin", "SalesManager"), crudRateLimiter, async (req: AuthRequest, res) => {
    try {
      await db.delete(schema.offers).where(eq(schema.offers.id, req.params.id));
      await createAuditLog(req.user?.id, "delete", "Offer", req.params.id, null, null, req);
      return res.json({ success: true });
    } catch (err) {
      return res.status(500).json({ error: "Failed to delete offer" });
    }
  });


  app.get("/api/lead-gen/playbooks", authenticate, requireRole("Admin", "SalesManager", "SalesRep", "ReadOnly", "SalesOperator", "Reviewer"), readRateLimiter, async (req: AuthRequest, res) => {
    try {
      const playbooks = await db.select().from(schema.taskPlaybooks).orderBy(desc(schema.taskPlaybooks.createdAt));
      return res.json(playbooks);
    } catch (err) {
      return res.status(500).json({ error: "Failed to fetch playbooks" });
    }
  });

  app.get("/api/lead-gen/playbooks/:id", authenticate, requireRole("Admin", "SalesManager", "SalesRep", "ReadOnly", "SalesOperator", "Reviewer"), readRateLimiter, async (req: AuthRequest, res) => {
    try {
      const playbook = await db.select().from(schema.taskPlaybooks).where(eq(schema.taskPlaybooks.id, req.params.id)).limit(1);
      if (!playbook[0]) return res.status(404).json({ error: "Playbook not found" });
      const steps = await db.select().from(schema.taskPlaybookSteps)
        .where(eq(schema.taskPlaybookSteps.playbookId, req.params.id))
        .orderBy(schema.taskPlaybookSteps.stepOrder);
      return res.json({ ...playbook[0], steps });
    } catch (err) {
      return res.status(500).json({ error: "Failed to fetch playbook" });
    }
  });

  app.post("/api/lead-gen/playbooks", authenticate, requireRole("Admin", "SalesManager"), crudRateLimiter, async (req: AuthRequest, res) => {
    try {
      const data = insertTaskPlaybookSchema.parse({ ...req.body, createdBy: req.user?.id });
      const result = await db.insert(schema.taskPlaybooks).values(data).returning();
      await createLgAudit(req.user?.id, "playbook_created", "TaskPlaybook", result[0].id, null, result[0]);
      await createAuditLog(req.user?.id, "create", "TaskPlaybook", result[0].id, null, result[0] as unknown as Record<string, unknown>, req);
      return res.json(result[0]);
    } catch (err) {
      if (err instanceof z.ZodError) return res.status(400).json({ error: "Validation failed", details: err.errors });
      return res.status(500).json({ error: "Failed to create playbook" });
    }
  });

  const playbookPatchSchema = z.object({
    name: z.string().min(1).optional(),
    description: z.string().optional().nullable(),
    icpProfileId: z.string().optional().nullable(),
    isActive: z.boolean().optional(),
  });

  app.patch("/api/lead-gen/playbooks/:id", authenticate, requireRole("Admin", "SalesManager"), crudRateLimiter, async (req: AuthRequest, res) => {
    try {
      const parsed = playbookPatchSchema.safeParse(req.body);
      if (!parsed.success) return res.status(400).json({ error: "Invalid fields", details: parsed.error.errors });
      const result = await db.update(schema.taskPlaybooks)
        .set({ ...parsed.data, updatedAt: new Date() })
        .where(eq(schema.taskPlaybooks.id, req.params.id))
        .returning();
      if (!result[0]) return res.status(404).json({ error: "Playbook not found" });
      await createAuditLog(req.user?.id, "update", "TaskPlaybook", req.params.id, null, result[0] as unknown as Record<string, unknown>, req);
      return res.json(result[0]);
    } catch (err) {
      return res.status(500).json({ error: "Failed to update playbook" });
    }
  });

  app.delete("/api/lead-gen/playbooks/:id", authenticate, requireRole("Admin", "SalesManager"), crudRateLimiter, async (req: AuthRequest, res) => {
    try {
      const toDelete = await db.select().from(schema.taskPlaybooks).where(eq(schema.taskPlaybooks.id, req.params.id)).limit(1);
      await db.delete(schema.taskPlaybooks).where(eq(schema.taskPlaybooks.id, req.params.id));
      if (toDelete[0]) {
        await createLgAudit(req.user?.id, "playbook_deleted", "TaskPlaybook", req.params.id, null, toDelete[0]);
        await createAuditLog(req.user?.id, "delete", "TaskPlaybook", req.params.id, toDelete[0] as unknown as Record<string, unknown>, null, req);
      }
      return res.json({ success: true });
    } catch (err) {
      return res.status(500).json({ error: "Failed to delete playbook" });
    }
  });


  app.post("/api/lead-gen/playbooks/:id/steps", authenticate, requireRole("Admin", "SalesManager"), crudRateLimiter, async (req: AuthRequest, res) => {
    try {
      const data = insertTaskPlaybookStepSchema.parse({ ...req.body, playbookId: req.params.id });
      const result = await db.insert(schema.taskPlaybookSteps).values(data).returning();
      await createAuditLog(req.user?.id, "create", "PlaybookStep", result[0].id, null, result[0] as unknown as Record<string, unknown>, req);
      return res.json(result[0]);
    } catch (err) {
      if (err instanceof z.ZodError) return res.status(400).json({ error: "Validation failed", details: err.errors });
      return res.status(500).json({ error: "Failed to create playbook step" });
    }
  });

  const playbookStepPatchSchema = z.object({
    name: z.string().min(1).optional(),
    description: z.string().optional().nullable(),
    activityType: z.enum(["call", "email", "meeting", "task", "note"]).optional(),
    stepOrder: z.number().int().min(1).optional(),
    dayOffset: z.number().int().min(0).optional(),
  });

  app.patch("/api/lead-gen/playbook-steps/:id", authenticate, requireRole("Admin", "SalesManager"), crudRateLimiter, async (req: AuthRequest, res) => {
    try {
      const parsed = playbookStepPatchSchema.safeParse(req.body);
      if (!parsed.success) return res.status(400).json({ error: "Invalid fields", details: parsed.error.errors });
      const result = await db.update(schema.taskPlaybookSteps)
        .set(parsed.data)
        .where(eq(schema.taskPlaybookSteps.id, req.params.id))
        .returning();
      if (!result[0]) return res.status(404).json({ error: "Step not found" });
      await createAuditLog(req.user?.id, "update", "PlaybookStep", req.params.id, null, result[0] as unknown as Record<string, unknown>, req);
      return res.json(result[0]);
    } catch (err) {
      return res.status(500).json({ error: "Failed to update playbook step" });
    }
  });

  app.delete("/api/lead-gen/playbook-steps/:id", authenticate, requireRole("Admin", "SalesManager"), crudRateLimiter, async (req: AuthRequest, res) => {
    try {
      await db.delete(schema.taskPlaybookSteps).where(eq(schema.taskPlaybookSteps.id, req.params.id));
      await createAuditLog(req.user?.id, "delete", "PlaybookStep", req.params.id, null, null, req);
      return res.json({ success: true });
    } catch (err) {
      return res.status(500).json({ error: "Failed to delete playbook step" });
    }
  });


  app.get("/api/lead-gen/runs", authenticate, requireRole("Admin", "SalesManager", "SalesRep", "ReadOnly", "SalesOperator", "Reviewer"), readRateLimiter, async (req: AuthRequest, res) => {
    try {
      const runs = await db.select().from(schema.leadGenerationRuns).orderBy(desc(schema.leadGenerationRuns.createdAt));
      return res.json(runs);
    } catch (err) {
      return res.status(500).json({ error: "Failed to fetch runs" });
    }
  });

  app.get("/api/lead-gen/runs/:id", authenticate, requireRole("Admin", "SalesManager", "SalesRep", "ReadOnly", "SalesOperator", "Reviewer"), readRateLimiter, async (req: AuthRequest, res) => {
    try {
      const run = await db.select().from(schema.leadGenerationRuns).where(eq(schema.leadGenerationRuns.id, req.params.id)).limit(1);
      if (!run[0]) return res.status(404).json({ error: "Run not found" });

      const rawCandidates = await db.select({
        candidate: schema.candidateLeads,
        accountName: schema.candidateAccounts.name,
        contactFirstName: schema.candidateContacts.firstName,
        contactLastName: schema.candidateContacts.lastName,
        contactEmail: schema.candidateContacts.email,
        contactTitle: schema.candidateContacts.title,
      })
        .from(schema.candidateLeads)
        .leftJoin(schema.candidateAccounts, eq(schema.candidateLeads.candidateAccountId, schema.candidateAccounts.id))
        .leftJoin(schema.candidateContacts, eq(schema.candidateLeads.candidateContactId, schema.candidateContacts.id))
        .where(eq(schema.candidateLeads.runId, req.params.id))
        .orderBy(desc(schema.candidateLeads.createdAt));

      const candidates = rawCandidates.map((r: typeof rawCandidates[number]) => ({
        ...r.candidate,
        accountName: r.accountName,
        contactName: r.contactFirstName && r.contactLastName ? `${r.contactFirstName} ${r.contactLastName}` : r.contactFirstName || null,
        contactEmail: r.contactEmail,
        contactTitle: r.contactTitle,
      }));

      return res.json({ ...run[0], candidates });
    } catch (err) {
      return res.status(500).json({ error: "Failed to fetch run" });
    }
  });

  app.post("/api/lead-gen/runs", authenticate, requireRole("Admin", "SalesManager", "SalesOperator"), crudRateLimiter, async (req: AuthRequest, res) => {
    try {
      const body = { ...req.body, createdBy: req.user?.id, ownerId: req.user?.id };
      if (body.icpProfileId && !body.icpVersionId) {
        const activeVersion = await db.select().from(schema.icpProfileVersions)
          .where(and(
            eq(schema.icpProfileVersions.icpProfileId, body.icpProfileId),
            eq(schema.icpProfileVersions.isActive, true),
          ))
          .orderBy(desc(schema.icpProfileVersions.versionNumber))
          .limit(1);
        if (activeVersion[0]) {
          body.icpVersionId = activeVersion[0].id;
        }
      }
      const data = insertLeadGenerationRunSchema.parse(body);
      const result = await db.insert(schema.leadGenerationRuns).values(data).returning();
      await createLgAudit(req.user?.id, "run_created", "LeadGenerationRun", result[0].id, result[0].id, result[0]);
      await createAuditLog(req.user?.id, "create", "LeadGenerationRun", result[0].id, null, result[0] as unknown as Record<string, unknown>, req);
      return res.json(result[0]);
    } catch (err) {
      if (err instanceof z.ZodError) return res.status(400).json({ error: "Validation failed", details: err.errors });
      return res.status(500).json({ error: "Failed to create run" });
    }
  });

  app.post("/api/lead-gen/runs/:id/start", authenticate, requireRole("Admin", "SalesManager", "SalesOperator"), crudRateLimiter, async (req: AuthRequest, res) => {
    try {
      const run = await db.select().from(schema.leadGenerationRuns).where(eq(schema.leadGenerationRuns.id, req.params.id)).limit(1);
      if (!run[0]) return res.status(404).json({ error: "Run not found" });
      if (run[0].status !== "draft") return res.status(400).json({ error: "Run must be in draft status to start" });

      const result = await db.update(schema.leadGenerationRuns)
        .set({
          status: "active",
          startedAt: new Date(),
          currentPhase: "market_research",
          errorPhase: null,
          errorReason: null,
          updatedAt: new Date(),
        })
        .where(eq(schema.leadGenerationRuns.id, req.params.id))
        .returning();

      await createLgAudit(req.user?.id, "run_started", "LeadGenerationRun", req.params.id, req.params.id, { pipeline: "ai_agent" });
      await createAuditLog(req.user?.id, "update", "LeadGenerationRun", req.params.id, null, { status: "active" }, req);

      runLeadGenPipeline(req.params.id).catch(err => {
        console.error(`[Agent] Pipeline error for run ${req.params.id}:`, err);
      });

      return res.json({ ...result[0], pipelineStarted: true });
    } catch (err) {
      console.error(err);
      return res.status(500).json({ error: "Failed to start run" });
    }
  });

  app.post("/api/lead-gen/runs/:id/retry-phase", authenticate, requireRole("Admin", "SalesManager", "SalesOperator"), crudRateLimiter, async (req: AuthRequest, res) => {
    try {
      const run = await db.select().from(schema.leadGenerationRuns).where(eq(schema.leadGenerationRuns.id, req.params.id)).limit(1);
      if (!run[0]) return res.status(404).json({ error: "Run not found" });
      if (run[0].status !== "active" && run[0].status !== "error") return res.status(400).json({ error: "Run must be active or in error state to retry a phase" });

      const failedPhase = req.body?.startFromPhase || req.body?.phase || run[0].errorPhase;
      if (!failedPhase) return res.status(400).json({ error: "No failed phase to retry. Provide a 'phase' in the request body." });

      const validPhases = ["market_research", "company_discovery", "contact_discovery", "strategy", "communication_drafting"];
      if (!validPhases.includes(failedPhase)) {
        return res.status(400).json({ error: `Invalid phase '${failedPhase}'. Valid phases: ${validPhases.join(", ")}` });
      }

      await db.update(schema.leadGenerationRuns)
        .set({
          status: "active",
          currentPhase: failedPhase,
          errorPhase: null,
          errorReason: null,
          updatedAt: new Date(),
        })
        .where(eq(schema.leadGenerationRuns.id, req.params.id));

      await createLgAudit(req.user?.id, "run_phase_retry", "LeadGenerationRun", req.params.id, req.params.id, { phase: failedPhase });

      runLeadGenPipeline(req.params.id, failedPhase).catch(err => {
        console.error(`[Agent] Retry pipeline error for run ${req.params.id} phase ${failedPhase}:`, err);
      });

      const updatedRun = await db.select().from(schema.leadGenerationRuns).where(eq(schema.leadGenerationRuns.id, req.params.id)).limit(1);
      return res.json({ ...updatedRun[0], retrying: true, phase: failedPhase });
    } catch (err) {
      console.error(err);
      return res.status(500).json({ error: "Failed to retry phase" });
    }
  });

  // Explicit status transitions: active→reviewing, reviewing→complete
  app.post("/api/lead-gen/runs/:id/advance-status", authenticate, requireRole("Admin", "SalesManager", "SalesOperator"), crudRateLimiter, async (req: AuthRequest, res) => {
    try {
      const run = await db.select().from(schema.leadGenerationRuns).where(eq(schema.leadGenerationRuns.id, req.params.id)).limit(1);
      if (!run[0]) return res.status(404).json({ error: "Run not found" });

      const transitions: Record<string, schema.LeadGenerationRun["status"]> = {
        active: "reviewing",
        reviewing: "complete",
      };
      const nextStatus = transitions[run[0].status];
      if (!nextStatus) return res.status(400).json({ error: `Cannot advance run from status '${run[0].status}'` });

      const extra: Partial<typeof schema.leadGenerationRuns.$inferInsert> = nextStatus === "complete" ? { completedAt: new Date() } : {};
      const result = await db.update(schema.leadGenerationRuns)
        .set({ status: nextStatus, ...extra, updatedAt: new Date() })
        .where(eq(schema.leadGenerationRuns.id, req.params.id))
        .returning();

      await createLgAudit(req.user?.id, `run_status_${nextStatus}`, "LeadGenerationRun", req.params.id, req.params.id, { from: run[0].status, to: nextStatus });
      await createAuditLog(req.user?.id, "update", "LeadGenerationRun", req.params.id, null, { status: nextStatus }, req);
      return res.json(result[0]);
    } catch (err) {
      console.error(err);
      return res.status(500).json({ error: "Failed to advance run status" });
    }
  });

  const runPatchSchema = z.object({
    name: z.string().min(1).optional(),
    description: z.string().optional().nullable(),
    icpProfileId: z.string().optional().nullable(),
    icpVersionId: z.string().optional().nullable(),
    ownerId: z.string().optional().nullable(),
    targetCount: z.number().int().positive().optional().nullable(),
  });

  app.patch("/api/lead-gen/runs/:id", authenticate, requireRole("Admin", "SalesManager", "SalesOperator"), crudRateLimiter, async (req: AuthRequest, res) => {
    try {
      const parsed = runPatchSchema.safeParse(req.body);
      if (!parsed.success) return res.status(400).json({ error: "Invalid fields", details: parsed.error.errors });
      const result = await db.update(schema.leadGenerationRuns)
        .set({ ...parsed.data, updatedAt: new Date() })
        .where(eq(schema.leadGenerationRuns.id, req.params.id))
        .returning();
      if (!result[0]) return res.status(404).json({ error: "Run not found" });
      await createLgAudit(req.user?.id, "run_updated", "LeadGenerationRun", req.params.id, req.params.id, parsed.data as Record<string, unknown>);
      await createAuditLog(req.user?.id, "update", "LeadGenerationRun", req.params.id, null, parsed.data as Record<string, unknown>, req);
      return res.json(result[0]);
    } catch (err) {
      return res.status(500).json({ error: "Failed to update run" });
    }
  });


  app.post("/api/lead-gen/runs/:runId/candidate-accounts", authenticate, requireRole("Admin", "SalesManager", "SalesOperator"), crudRateLimiter, async (req: AuthRequest, res) => {
    try {
      const data = insertCandidateAccountSchema.parse({ ...req.body, runId: req.params.runId });
      const result = await db.insert(schema.candidateAccounts).values(data).returning();
      await createLgAudit(req.user?.id, "candidate_account_staged", "CandidateAccount", result[0].id, req.params.runId, result[0]);
      await createAuditLog(req.user?.id, "create", "CandidateAccount", result[0].id, null, result[0] as unknown as Record<string, unknown>, req);
      return res.json(result[0]);
    } catch (err) {
      if (err instanceof z.ZodError) return res.status(400).json({ error: "Validation failed", details: err.errors });
      return res.status(500).json({ error: "Failed to create candidate account" });
    }
  });

  app.get("/api/lead-gen/runs/:runId/candidate-accounts", authenticate, requireRole("Admin", "SalesManager", "SalesRep", "ReadOnly", "SalesOperator", "Reviewer"), readRateLimiter, async (req: AuthRequest, res) => {
    try {
      const accounts = await db.select().from(schema.candidateAccounts)
        .where(eq(schema.candidateAccounts.runId, req.params.runId));
      return res.json(accounts);
    } catch (err) {
      return res.status(500).json({ error: "Failed to fetch candidate accounts" });
    }
  });


  app.post("/api/lead-gen/runs/:runId/candidate-contacts", authenticate, requireRole("Admin", "SalesManager", "SalesOperator"), crudRateLimiter, async (req: AuthRequest, res) => {
    try {
      const data = insertCandidateContactSchema.parse({ ...req.body, runId: req.params.runId });
      const result = await db.insert(schema.candidateContacts).values(data).returning();
      await createLgAudit(req.user?.id, "candidate_contact_staged", "CandidateContact", result[0].id, req.params.runId, result[0]);
      await createAuditLog(req.user?.id, "create", "CandidateContact", result[0].id, null, result[0] as unknown as Record<string, unknown>, req);
      return res.json(result[0]);
    } catch (err) {
      if (err instanceof z.ZodError) return res.status(400).json({ error: "Validation failed", details: err.errors });
      return res.status(500).json({ error: "Failed to create candidate contact" });
    }
  });


  app.post("/api/lead-gen/runs/:runId/candidates", authenticate, requireRole("Admin", "SalesManager", "SalesOperator"), crudRateLimiter, async (req: AuthRequest, res) => {
    try {
      const data = insertCandidateLeadSchema.parse({ ...req.body, runId: req.params.runId, createdBy: req.user?.id });
      const result = await db.insert(schema.candidateLeads).values(data).returning();
      // Update run candidate count
      await db.update(schema.leadGenerationRuns)
        .set({ candidateCount: sql`${schema.leadGenerationRuns.candidateCount} + 1`, updatedAt: new Date() })
        .where(eq(schema.leadGenerationRuns.id, req.params.runId));
      await createLgAudit(req.user?.id, "candidate_staged", "CandidateLead", result[0].id, req.params.runId, result[0]);
      await createAuditLog(req.user?.id, "create", "CandidateLead", result[0].id, null, result[0] as unknown as Record<string, unknown>, req);
      return res.json(result[0]);
    } catch (err) {
      if (err instanceof z.ZodError) return res.status(400).json({ error: "Validation failed", details: err.errors });
      return res.status(500).json({ error: "Failed to create candidate lead" });
    }
  });


  app.post("/api/lead-gen/candidates/:id/scores", authenticate, requireRole("Admin", "SalesManager", "SalesOperator"), crudRateLimiter, async (req: AuthRequest, res) => {
    try {
      const data = insertCandidateScoreSchema.parse({ ...req.body, candidateLeadId: req.params.id });
      const result = await db.insert(schema.candidateScores).values(data).returning();
      await createLgAudit(req.user?.id, "candidate_scored", "CandidateScore", result[0].id, null, { candidateLeadId: req.params.id, score: result[0].totalScore });
      await createAuditLog(req.user?.id, "create", "CandidateScore", result[0].id, null, result[0] as unknown as Record<string, unknown>, req);
      return res.json(result[0]);
    } catch (err) {
      if (err instanceof z.ZodError) return res.status(400).json({ error: "Validation failed", details: err.errors });
      return res.status(500).json({ error: "Failed to create candidate score" });
    }
  });


  app.post("/api/lead-gen/candidates/:id/evidence", authenticate, requireRole("Admin", "SalesManager", "SalesOperator"), crudRateLimiter, async (req: AuthRequest, res) => {
    try {
      const data = insertEvidenceSourceSchema.parse({ ...req.body, candidateLeadId: req.params.id });
      const result = await db.insert(schema.evidenceSources).values(data).returning();
      await createLgAudit(req.user?.id, "evidence_added", "EvidenceSource", result[0].id, null, { candidateLeadId: req.params.id, sourceType: result[0].sourceType });
      await createAuditLog(req.user?.id, "create", "EvidenceSource", result[0].id, null, result[0] as unknown as Record<string, unknown>, req);
      return res.json(result[0]);
    } catch (err) {
      if (err instanceof z.ZodError) return res.status(400).json({ error: "Validation failed", details: err.errors });
      return res.status(500).json({ error: "Failed to create evidence source" });
    }
  });


  app.get("/api/lead-gen/candidates", authenticate, requireRole("Admin", "SalesManager", "SalesRep", "ReadOnly", "SalesOperator", "Reviewer"), readRateLimiter, async (req: AuthRequest, res) => {
    try {
      const { tier, status, duplicateClass, runId, icpId, ownerId, page = "1", limit = "50" } = req.query as Record<string, string>;

      const conditions: SQL<unknown>[] = [];
      if (tier) conditions.push(eq(schema.candidateLeads.tier, tier as "tier_1" | "tier_2" | "tier_3"));
      if (status) conditions.push(eq(schema.candidateLeads.status, status as schema.CandidateLead["status"]));
      if (duplicateClass) conditions.push(eq(schema.candidateLeads.duplicateClass, duplicateClass as schema.CandidateLead["duplicateClass"]));
      if (runId) conditions.push(eq(schema.candidateLeads.runId, runId));
      if (icpId) conditions.push(eq(schema.leadGenerationRuns.icpProfileId, icpId));
      if (ownerId) conditions.push(eq(schema.leadGenerationRuns.ownerId, ownerId));

      const pageNum = parseInt(page, 10);
      const limitNum = Math.min(parseInt(limit, 10), 100);
      const offset = (pageNum - 1) * limitNum;

      const results = await db.select({
        candidate: schema.candidateLeads,
        account: schema.candidateAccounts,
        contact: schema.candidateContacts,
        score: sql<{ totalScore: number; maxScore: number } | null>`(
          SELECT json_build_object('totalScore', cs.total_score, 'maxScore', cs.max_score)
          FROM candidate_scores cs
          WHERE cs.candidate_lead_id = ${schema.candidateLeads.id}
          ORDER BY cs.created_at DESC
          LIMIT 1
        )`,
        run: schema.leadGenerationRuns,
      })
        .from(schema.candidateLeads)
        .leftJoin(schema.candidateAccounts, eq(schema.candidateLeads.candidateAccountId, schema.candidateAccounts.id))
        .leftJoin(schema.candidateContacts, eq(schema.candidateLeads.candidateContactId, schema.candidateContacts.id))
        .leftJoin(schema.leadGenerationRuns, eq(schema.candidateLeads.runId, schema.leadGenerationRuns.id))
        .where(conditions.length > 0 ? and(...conditions) : undefined)
        .orderBy(desc(schema.candidateLeads.createdAt))
        .limit(limitNum)
        .offset(offset);

      const countResult = await db.select({ count: sql<number>`count(*)::int` })
        .from(schema.candidateLeads)
        .leftJoin(schema.leadGenerationRuns, eq(schema.candidateLeads.runId, schema.leadGenerationRuns.id))
        .where(conditions.length > 0 ? and(...conditions) : undefined);

      const total = countResult[0]?.count ?? 0;
      const mapped = (results as CandidateQueryRow[]).map(r => ({
        ...r.candidate,
        accountName: r.account?.name,
        contactName: r.contact ? `${r.contact.firstName} ${r.contact.lastName}` : null,
        score: r.score,
        runName: r.run?.name,
      }));
      return res.json({ candidates: mapped, total, page: pageNum, limit: limitNum });
    } catch (err) {
      console.error(err);
      return res.status(500).json({ error: "Failed to fetch review queue" });
    }
  });

  // Single candidate detail
  app.get("/api/lead-gen/candidates/:id", authenticate, requireRole("Admin", "SalesManager", "SalesRep", "ReadOnly", "SalesOperator", "Reviewer"), readRateLimiter, async (req: AuthRequest, res) => {
    try {
      const candidate = await db.select().from(schema.candidateLeads).where(eq(schema.candidateLeads.id, req.params.id)).limit(1);
      if (!candidate[0]) return res.status(404).json({ error: "Candidate not found" });

      const [account, scores, evidence, decisions, linkedLead] = await Promise.all([
        candidate[0].candidateAccountId
          ? db.select().from(schema.candidateAccounts).where(eq(schema.candidateAccounts.id, candidate[0].candidateAccountId!)).limit(1)
          : Promise.resolve([]),
        db.select().from(schema.candidateScores).where(eq(schema.candidateScores.candidateLeadId, req.params.id)),
        db.select().from(schema.evidenceSources).where(eq(schema.evidenceSources.candidateLeadId, req.params.id)),
        db.select().from(schema.reviewDecisions).where(eq(schema.reviewDecisions.candidateLeadId, req.params.id)).orderBy(desc(schema.reviewDecisions.createdAt)),
        db.select().from(schema.lgCrmLeads).where(eq(schema.lgCrmLeads.candidateLeadId, req.params.id)).limit(1),
      ]);

      let contacts: schema.CandidateContact[] = [];
      if (candidate[0].candidateContactId) {
        contacts = await db.select().from(schema.candidateContacts)
          .where(eq(schema.candidateContacts.id, candidate[0].candidateContactId!));
      } else if (candidate[0].candidateAccountId) {
        contacts = await db.select().from(schema.candidateContacts)
          .where(eq(schema.candidateContacts.candidateAccountId, candidate[0].candidateAccountId!));
      }

      let playbook: schema.TaskPlaybook | null = null;
      let playbookSteps: schema.TaskPlaybookStep[] = [];
      if (candidate[0].assignedPlaybookId) {
        const pbResult = await db.select().from(schema.taskPlaybooks)
          .where(eq(schema.taskPlaybooks.id, candidate[0].assignedPlaybookId!)).limit(1);
        playbook = pbResult[0] || null;
        if (playbook) {
          playbookSteps = await db.select().from(schema.taskPlaybookSteps)
            .where(eq(schema.taskPlaybookSteps.playbookId, candidate[0].assignedPlaybookId!))
            .orderBy(schema.taskPlaybookSteps.stepOrder);
        }
      }

      // Run context
      const run = await db.select().from(schema.leadGenerationRuns).where(eq(schema.leadGenerationRuns.id, candidate[0].runId)).limit(1);

      return res.json({
        ...candidate[0],
        account: account[0] || null,
        contacts,
        scores,
        evidence,
        decisions,
        playbook,
        playbookSteps,
        run: run[0] || null,
        crmLeadId: linkedLead[0]?.crmLeadId || null,
      });
    } catch (err) {
      console.error(err);
      return res.status(500).json({ error: "Failed to fetch candidate" });
    }
  });

  // Inline edit candidate
  const candidatePatchSchema = z.object({
    assignedPlaybookId: z.string().optional().nullable(),
    tier: z.enum(["tier_1", "tier_2", "tier_3"]).optional().nullable(),
    verificationStatus: z.enum(["unverified", "partial", "verified"]).optional(),
    reviewNote: z.string().optional().nullable(),
  });

  app.patch("/api/lead-gen/candidates/:id", authenticate, requireRole("Admin", "SalesManager", "SalesOperator", "Reviewer"), crudRateLimiter, async (req: AuthRequest, res) => {
    try {
      const parsed = candidatePatchSchema.safeParse(req.body);
      if (!parsed.success) return res.status(400).json({ error: "Invalid fields", details: parsed.error.errors });
      const before = await db.select().from(schema.candidateLeads).where(eq(schema.candidateLeads.id, req.params.id)).limit(1);
      if (!before[0]) return res.status(404).json({ error: "Candidate not found" });
      const result = await db.update(schema.candidateLeads)
        .set({ ...parsed.data, updatedAt: new Date() })
        .where(eq(schema.candidateLeads.id, req.params.id))
        .returning();
      await createLgAudit(req.user?.id, "candidate_edited", "CandidateLead", req.params.id, before[0].runId, { before: before[0], after: result[0] });
      await createAuditLog(req.user?.id, "update", "CandidateLead", req.params.id, before[0] as unknown as Record<string, unknown>, result[0] as unknown as Record<string, unknown>, req);
      return res.json(result[0]);
    } catch (err) {
      return res.status(500).json({ error: "Failed to update candidate" });
    }
  });


  async function approveCandidate(candidateId: string, actorId: string, note: string | undefined, req: { ip?: string; headers?: Record<string, string | string[] | undefined> }) {
    // Pre-flight reads (outside transaction for performance)
    const candidate = await db.select().from(schema.candidateLeads).where(eq(schema.candidateLeads.id, candidateId)).limit(1);
    if (!candidate[0]) throw new Error("Candidate not found");
    if (candidate[0].status !== "pending_review") throw new Error(`Cannot approve: candidate is already '${candidate[0].status}'. Only pending_review candidates can be actioned.`);

    const [accountRows, contactRows, playbookSteps] = await Promise.all([
      candidate[0].candidateAccountId
        ? db.select().from(schema.candidateAccounts).where(eq(schema.candidateAccounts.id, candidate[0].candidateAccountId!)).limit(1)
        : Promise.resolve([] as schema.CandidateAccount[]),
      candidate[0].candidateContactId
        ? db.select().from(schema.candidateContacts).where(eq(schema.candidateContacts.id, candidate[0].candidateContactId!)).limit(1)
        : Promise.resolve([] as schema.CandidateContact[]),
      candidate[0].assignedPlaybookId
        ? db.select().from(schema.taskPlaybookSteps).where(eq(schema.taskPlaybookSteps.playbookId, candidate[0].assignedPlaybookId!)).orderBy(schema.taskPlaybookSteps.stepOrder)
        : Promise.resolve([] as schema.TaskPlaybookStep[]),
    ]);

    // Fetch all research documents attached to candidate records
    const candidateDocConditions = [
      and(eq(researchDocuments.entityType, "candidate_lead"), eq(researchDocuments.entityId, candidateId)),
      ...(candidate[0].candidateAccountId
        ? [and(eq(researchDocuments.entityType, "candidate_account"), eq(researchDocuments.entityId, candidate[0].candidateAccountId!))]
        : []),
      ...(candidate[0].candidateContactId
        ? [and(eq(researchDocuments.entityType, "candidate_contact"), eq(researchDocuments.entityId, candidate[0].candidateContactId!))]
        : []),
    ];
    const candidateDocs: ResearchDocument[] = await db.select().from(researchDocuments)
      .where(or(...candidateDocConditions));

    const accountData = accountRows[0];
    const contactData = contactRows[0];

    // Duplicate check
    let duplicateClass: "unique" | "possible_duplicate" | "confirmed_duplicate" = "unique";
    if (contactData?.email) {
      const existingByEmail = await db.select().from(schema.leads).where(eq(schema.leads.email, contactData.email)).limit(1);
      if (existingByEmail.length > 0) duplicateClass = "confirmed_duplicate";
    }
    if (duplicateClass === "unique" && contactData?.firstName && contactData?.lastName && accountData?.name) {
      const fullName = `${contactData.firstName} ${contactData.lastName}`.toLowerCase();
      const existingByName = await db.select().from(schema.leads).where(eq(schema.leads.company, accountData.name)).limit(5);
      const nameMatch = (existingByName as schema.Lead[]).some(l => `${l.firstName} ${l.lastName}`.toLowerCase() === fullName);
      if (nameMatch) duplicateClass = "confirmed_duplicate";
      else if (existingByName.length > 0) duplicateClass = "possible_duplicate";
    } else if (duplicateClass === "unique" && accountData?.name) {
      const existing = await db.select().from(schema.leads).where(eq(schema.leads.company, accountData.name)).limit(1);
      if (existing.length > 0) duplicateClass = "possible_duplicate";
    }

    // Pre-generate IDs (outside transaction, no side effects)
    const crmLeadId = await storage.generateId("Lead");
    const activityIds: string[] = [];
    for (let i = 0; i < playbookSteps.length; i++) {
      activityIds.push(await storage.generateId("Activity"));
    }

    // All DB writes in a single atomic transaction
    let crmLead: schema.Lead;
    await (db as TypedPgDb).transaction(async (tx) => {
      // Insert CRM lead
      const leadRows = await tx.insert(schema.leads).values({
        id: crmLeadId,
        firstName: contactData?.firstName || accountData?.name || "Unknown",
        lastName: contactData?.lastName || "",
        company: accountData?.name || "",
        email: contactData?.email || null,
        phone: contactData?.phone || null,
        status: "new",
        source: "other",
      }).returning();
      crmLead = leadRows[0];

      // Link lg_crm_leads
      await tx.insert(schema.lgCrmLeads).values({
        candidateLeadId: candidateId,
        crmLeadId: crmLead.id,
        runId: candidate[0].runId,
      });

      // Create activities from playbook steps
      for (let i = 0; i < playbookSteps.length; i++) {
        const step = playbookSteps[i];
        const dueAt = new Date();
        dueAt.setDate(dueAt.getDate() + step.dayOffset);
        const activityId = activityIds[i];
        await tx.insert(schema.activities).values({
          id: activityId,
          type: step.activityType as "call" | "email" | "meeting" | "task" | "note",
          subject: step.name,
          status: "pending",
          priority: "medium",
          dueAt: dueAt,
          ownerId: actorId,
          notes: step.description || null,
        });
        await tx.insert(schema.lgCrmTasks).values({
          candidateLeadId: candidateId,
          activityId: activityId,
          playbookStepId: step.id,
          runId: candidate[0].runId,
        });
        await tx.insert(schema.activityAssociations).values({
          activityId: activityId,
          entityType: "Lead",
          entityId: crmLead.id,
        });
      }

      // Update candidate status - conditional WHERE guards against concurrent approval races
      const updateResult = await tx.update(schema.candidateLeads)
        .set({ status: "approved", duplicateClass, reviewedBy: actorId, reviewedAt: new Date(), updatedAt: new Date() })
        .where(and(eq(schema.candidateLeads.id, candidateId), eq(schema.candidateLeads.status, "pending_review")))
        .returning();
      if (!updateResult[0]) throw new Error("Cannot approve: candidate was already actioned by another user");

      // Update run counters
      await tx.update(schema.leadGenerationRuns)
        .set({ approvedCount: sql`${schema.leadGenerationRuns.approvedCount} + 1`, reviewedCount: sql`${schema.leadGenerationRuns.reviewedCount} + 1`, updatedAt: new Date() })
        .where(eq(schema.leadGenerationRuns.id, candidate[0].runId));

      // Record decision
      await tx.insert(schema.reviewDecisions).values({
        candidateLeadId: candidateId,
        decisionType: "approve",
        decidedBy: actorId,
        note: note || null,
      });

      // Copy research documents to the CRM lead record
      if (candidateDocs.length > 0) {
        const docsToInsert = candidateDocs.map((doc: ResearchDocument) => ({
          entityType: "lead" as const,
          entityId: crmLead.id,
          documentType: doc.documentType,
          title: doc.title,
          content: doc.content,
          sourceAgentPhase: doc.sourceAgentPhase,
          runId: doc.runId,
          createdBy: doc.createdBy,
        }));
        await tx.insert(researchDocuments).values(docsToInsert);
      }
    });

    // Post-transaction audit logs (best-effort)
    await createLgAudit(actorId, "candidate_approved", "CandidateLead", candidateId, candidate[0].runId, { crmLeadId, duplicateClass });
    await createAuditLog(actorId, "create", "Lead", crmLeadId, null, crmLead! as unknown as Record<string, unknown>, req);

    return { candidate: candidateId, crmLeadId, duplicateClass };
  }

  app.post("/api/lead-gen/candidates/:id/approve", authenticate, requireRole("Admin", "SalesManager", "SalesOperator", "Reviewer"), crudRateLimiter, async (req: AuthRequest, res) => {
    try {
      const result = await approveCandidate(req.params.id, req.user!.id, req.body?.note, req);
      return res.json({ success: true, ...result });
    } catch (err) {
      console.error(err);
      const msg = err instanceof Error ? err.message : "Failed to approve candidate";
      if (msg.startsWith("Cannot approve:") || msg === "Candidate not found") {
        return res.status(msg === "Candidate not found" ? 404 : 409).json({ error: msg });
      }
      return res.status(500).json({ error: msg });
    }
  });

  app.post("/api/lead-gen/candidates/:id/reject", authenticate, requireRole("Admin", "SalesManager", "SalesOperator", "Reviewer"), crudRateLimiter, async (req: AuthRequest, res) => {
    try {
      const candidate = await db.select().from(schema.candidateLeads).where(eq(schema.candidateLeads.id, req.params.id)).limit(1);
      if (!candidate[0]) return res.status(404).json({ error: "Candidate not found" });
      if (candidate[0].status !== "pending_review") return res.status(409).json({ error: `Cannot reject: candidate is already '${candidate[0].status}'` });

      await (db as TypedPgDb).transaction(async (tx) => {
        const rejectResult = await tx.update(schema.candidateLeads)
          .set({ status: "rejected", reviewedBy: req.user!.id, reviewedAt: new Date(), reviewNote: req.body?.note, updatedAt: new Date() })
          .where(and(eq(schema.candidateLeads.id, req.params.id), eq(schema.candidateLeads.status, "pending_review")))
          .returning();
        if (!rejectResult[0]) throw new Error("Cannot reject: candidate was already actioned by another user");
        await tx.update(schema.leadGenerationRuns)
          .set({ rejectedCount: sql`${schema.leadGenerationRuns.rejectedCount} + 1`, reviewedCount: sql`${schema.leadGenerationRuns.reviewedCount} + 1`, updatedAt: new Date() })
          .where(eq(schema.leadGenerationRuns.id, candidate[0].runId));
        await tx.insert(schema.reviewDecisions).values({
          candidateLeadId: req.params.id,
          decisionType: "reject",
          decidedBy: req.user!.id,
          note: req.body?.note || null,
        });
      });

      await createLgAudit(req.user?.id, "candidate_rejected", "CandidateLead", req.params.id, candidate[0].runId, { note: req.body?.note });
      await createAuditLog(req.user?.id, "update", "CandidateLead", req.params.id, { status: candidate[0].status }, { status: "rejected" }, req);
      return res.json({ success: true });
    } catch (err) {
      console.error(err);
      const msg = err instanceof Error ? err.message : "Failed to reject candidate";
      if (msg.startsWith("Cannot reject:")) return res.status(409).json({ error: msg });
      return res.status(500).json({ error: msg });
    }
  });

  app.post("/api/lead-gen/candidates/:id/defer", authenticate, requireRole("Admin", "SalesManager", "SalesOperator", "Reviewer"), crudRateLimiter, async (req: AuthRequest, res) => {
    try {
      const candidate = await db.select().from(schema.candidateLeads).where(eq(schema.candidateLeads.id, req.params.id)).limit(1);
      if (!candidate[0]) return res.status(404).json({ error: "Candidate not found" });
      if (candidate[0].status !== "pending_review") return res.status(409).json({ error: `Cannot defer: candidate is already '${candidate[0].status}'` });

      await (db as TypedPgDb).transaction(async (tx) => {
        const deferResult = await tx.update(schema.candidateLeads)
          .set({ status: "deferred", reviewedBy: req.user!.id, reviewedAt: new Date(), reviewNote: req.body?.note, updatedAt: new Date() })
          .where(and(eq(schema.candidateLeads.id, req.params.id), eq(schema.candidateLeads.status, "pending_review")))
          .returning();
        if (!deferResult[0]) throw new Error("Cannot defer: candidate was already actioned by another user");
        await tx.update(schema.leadGenerationRuns)
          .set({ deferredCount: sql`${schema.leadGenerationRuns.deferredCount} + 1`, reviewedCount: sql`${schema.leadGenerationRuns.reviewedCount} + 1`, updatedAt: new Date() })
          .where(eq(schema.leadGenerationRuns.id, candidate[0].runId));
        await tx.insert(schema.reviewDecisions).values({
          candidateLeadId: req.params.id,
          decisionType: "defer",
          decidedBy: req.user!.id,
          note: req.body?.note || null,
        });
      });

      await createLgAudit(req.user?.id, "candidate_deferred", "CandidateLead", req.params.id, candidate[0].runId, { note: req.body?.note });
      await createAuditLog(req.user?.id, "update", "CandidateLead", req.params.id, { status: candidate[0].status }, { status: "deferred" }, req);
      return res.json({ success: true });
    } catch (err) {
      console.error(err);
      const msg = err instanceof Error ? err.message : "Failed to defer candidate";
      if (msg.startsWith("Cannot defer:")) return res.status(409).json({ error: msg });
      return res.status(500).json({ error: msg });
    }
  });

  // Bulk decisions
  app.post("/api/lead-gen/candidates/bulk-approve", authenticate, requireRole("Admin", "SalesManager", "SalesOperator", "Reviewer"), crudRateLimiter, async (req: AuthRequest, res) => {
    try {
      const { candidateIds, note } = req.body as { candidateIds: string[]; note?: string };
      if (!Array.isArray(candidateIds) || candidateIds.length === 0) {
        return res.status(400).json({ error: "candidateIds is required" });
      }
      const results = [];
      for (const id of candidateIds) {
        try {
          const r = await approveCandidate(id, req.user!.id, note, req);
          results.push({ id, success: true, ...r });
        } catch (e) {
          results.push({ id, success: false, error: e instanceof Error ? e.message : "Failed" });
        }
      }
      return res.json({ results });
    } catch (err) {
      return res.status(500).json({ error: "Failed to bulk approve" });
    }
  });

  app.post("/api/lead-gen/candidates/bulk-reject", authenticate, requireRole("Admin", "SalesManager", "SalesOperator", "Reviewer"), crudRateLimiter, async (req: AuthRequest, res) => {
    try {
      const { candidateIds, note } = req.body as { candidateIds: string[]; note?: string };
      if (!Array.isArray(candidateIds) || candidateIds.length === 0) {
        return res.status(400).json({ error: "candidateIds is required" });
      }
      let processedCount = 0;
      for (const id of candidateIds) {
        const candidate = await db.select().from(schema.candidateLeads).where(eq(schema.candidateLeads.id, id)).limit(1);
        if (!candidate[0] || candidate[0].status !== "pending_review") continue;
        const raceGuarded = await (db as TypedPgDb).transaction(async (tx) => {
          const bulkRejectResult = await tx.update(schema.candidateLeads)
            .set({ status: "rejected", reviewedBy: req.user!.id, reviewedAt: new Date(), reviewNote: note, updatedAt: new Date() })
            .where(and(eq(schema.candidateLeads.id, id), eq(schema.candidateLeads.status, "pending_review")))
            .returning();
          if (!bulkRejectResult[0]) return false;
          await tx.update(schema.leadGenerationRuns)
            .set({ rejectedCount: sql`${schema.leadGenerationRuns.rejectedCount} + 1`, reviewedCount: sql`${schema.leadGenerationRuns.reviewedCount} + 1`, updatedAt: new Date() })
            .where(eq(schema.leadGenerationRuns.id, candidate[0].runId));
          await tx.insert(schema.reviewDecisions).values({ candidateLeadId: id, decisionType: "reject", decidedBy: req.user!.id, note: note || null });
          return true;
        });
        if (raceGuarded) {
          await createLgAudit(req.user?.id, "candidate_rejected", "CandidateLead", id, candidate[0].runId, { bulk: true, note });
          await createAuditLog(req.user?.id, "update", "CandidateLead", id, { status: candidate[0].status }, { status: "rejected" }, req);
          processedCount++;
        }
      }
      return res.json({ success: true, count: processedCount });
    } catch (err) {
      return res.status(500).json({ error: "Failed to bulk reject" });
    }
  });

  app.post("/api/lead-gen/candidates/bulk-defer", authenticate, requireRole("Admin", "SalesManager", "SalesOperator", "Reviewer"), crudRateLimiter, async (req: AuthRequest, res) => {
    try {
      const { candidateIds, note } = req.body as { candidateIds: string[]; note?: string };
      if (!Array.isArray(candidateIds) || candidateIds.length === 0) {
        return res.status(400).json({ error: "candidateIds is required" });
      }
      let processedCount = 0;
      for (const id of candidateIds) {
        const candidate = await db.select().from(schema.candidateLeads).where(eq(schema.candidateLeads.id, id)).limit(1);
        if (!candidate[0] || candidate[0].status !== "pending_review") continue;
        const deferGuarded = await (db as TypedPgDb).transaction(async (tx) => {
          const bulkDeferResult = await tx.update(schema.candidateLeads)
            .set({ status: "deferred", reviewedBy: req.user!.id, reviewedAt: new Date(), reviewNote: note, updatedAt: new Date() })
            .where(and(eq(schema.candidateLeads.id, id), eq(schema.candidateLeads.status, "pending_review")))
            .returning();
          if (!bulkDeferResult[0]) return false;
          await tx.update(schema.leadGenerationRuns)
            .set({ deferredCount: sql`${schema.leadGenerationRuns.deferredCount} + 1`, reviewedCount: sql`${schema.leadGenerationRuns.reviewedCount} + 1`, updatedAt: new Date() })
            .where(eq(schema.leadGenerationRuns.id, candidate[0].runId));
          await tx.insert(schema.reviewDecisions).values({ candidateLeadId: id, decisionType: "defer", decidedBy: req.user!.id, note: note || null });
          return true;
        });
        if (deferGuarded) {
          await createLgAudit(req.user?.id, "candidate_deferred", "CandidateLead", id, candidate[0].runId, { bulk: true, note });
          await createAuditLog(req.user?.id, "update", "CandidateLead", id, { status: candidate[0].status }, { status: "deferred" }, req);
          processedCount++;
        }
      }
      return res.json({ success: true, count: processedCount });
    } catch (err) {
      return res.status(500).json({ error: "Failed to bulk defer" });
    }
  });


  app.get("/api/lead-gen/dashboard", authenticate, requireRole("Admin", "SalesManager", "SalesRep", "ReadOnly", "SalesOperator", "Reviewer"), readRateLimiter, async (req: AuthRequest, res) => {
    try {
      const today = new Date();
      today.setHours(0, 0, 0, 0);

      const [activeRunsResult, pendingReviewResult, approvalsToday, duplicateFlagsResult, tasksCreated] = await Promise.all([
        db.select({ count: sql<number>`count(*)` }).from(schema.leadGenerationRuns)
          .where(eq(schema.leadGenerationRuns.status, "active")),
        db.select({ count: sql<number>`count(*)` }).from(schema.candidateLeads)
          .where(eq(schema.candidateLeads.status, "pending_review")),
        db.select({ count: sql<number>`count(*)` }).from(schema.candidateLeads)
          .where(and(eq(schema.candidateLeads.status, "approved"), sql`${schema.candidateLeads.reviewedAt} >= ${today}`)),
        db.select({ count: sql<number>`count(*)` }).from(schema.candidateLeads)
          .where(ne(schema.candidateLeads.duplicateClass, "unique")),
        db.select({ count: sql<number>`count(*)` }).from(schema.lgCrmTasks),
      ]);

      return res.json({
        activeRuns: activeRunsResult[0]?.count || 0,
        pendingReview: pendingReviewResult[0]?.count || 0,
        approvalsToday: approvalsToday[0]?.count || 0,
        duplicatesFlagged: duplicateFlagsResult[0]?.count || 0,
        tasksCreated: tasksCreated[0]?.count || 0,
        meetingsBooked: 0,
      });
    } catch (err) {
      console.error(err);
      return res.status(500).json({ error: "Failed to fetch dashboard stats" });
    }
  });


  app.get("/api/lead-gen/reports", authenticate, requireRole("Admin", "SalesManager", "SalesRep", "ReadOnly", "SalesOperator", "Reviewer"), readRateLimiter, async (req: AuthRequest, res) => {
    try {
      const { runId: filterRunId } = req.query as { runId?: string };

      const staleThreshold = new Date();
      staleThreshold.setDate(staleThreshold.getDate() - 7);

      const [allRuns, allIcps, allCandidates, allTasks, staleDeferredRaw] = await Promise.all([
        db.select().from(schema.leadGenerationRuns),
        db.select().from(schema.icpProfiles),
        db.select({
          id: schema.candidateLeads.id,
          status: schema.candidateLeads.status,
          duplicateClass: schema.candidateLeads.duplicateClass,
          tier: schema.candidateLeads.tier,
          runId: schema.candidateLeads.runId,
          reviewedAt: schema.candidateLeads.reviewedAt,
          createdAt: schema.candidateLeads.createdAt,
        }).from(schema.candidateLeads),
        db.select({ candidateLeadId: schema.lgCrmTasks.candidateLeadId, runId: schema.lgCrmTasks.runId }).from(schema.lgCrmTasks),
        db.select({
          candidate: schema.candidateLeads,
          account: schema.candidateAccounts,
          run: schema.leadGenerationRuns,
        }).from(schema.candidateLeads)
          .leftJoin(schema.candidateAccounts, eq(schema.candidateLeads.candidateAccountId, schema.candidateAccounts.id))
          .leftJoin(schema.leadGenerationRuns, eq(schema.candidateLeads.runId, schema.leadGenerationRuns.id))
          .where(and(
            eq(schema.candidateLeads.status, "deferred"),
            lt(schema.candidateLeads.updatedAt, staleThreshold),
          ))
          .orderBy(schema.candidateLeads.updatedAt)
          .limit(50),
      ]);

      // Filter to selected run if provided
      const typedRuns = allRuns as schema.LeadGenerationRun[];
      const typedCandidates = allCandidates as schema.CandidateLead[];
      const typedTasks = allTasks as Array<{ runId: string | null }>;
      const filteredRuns = filterRunId ? typedRuns.filter(r => r.id === filterRunId) : typedRuns;
      const filteredCandidates = filterRunId ? typedCandidates.filter(c => c.runId === filterRunId) : typedCandidates;
      const filteredTasks = filterRunId ? typedTasks.filter(t => t.runId === filterRunId) : typedTasks;

      const tasksByRun = new Map<string, number>();
      for (const t of filteredTasks) {
        if (t.runId) tasksByRun.set(t.runId, (tasksByRun.get(t.runId) || 0) + 1);
      }

      // Run-level rows
      const rows = filteredRuns.map(run => {
        const runCandidates = filteredCandidates.filter(c => c.runId === run.id);
        const approved = runCandidates.filter(c => c.status === "approved").length;
        const rejected = runCandidates.filter(c => c.status === "rejected").length;
        const deferred = runCandidates.filter(c => c.status === "deferred").length;
        const reviewed = approved + rejected + deferred;
        const totalCandidates = runCandidates.length;
        const tasksCreated = tasksByRun.get(run.id) || 0;
        return {
          runId: run.id,
          runName: run.name,
          icpProfileId: run.icpProfileId,
          totalCandidates,
          reviewed,
          approved,
          rejected,
          deferred,
          conversionRate: totalCandidates > 0 ? (approved / totalCandidates) * 100 : 0,
          tier1Count: runCandidates.filter(c => c.tier === "tier_1").length,
          tier2Count: runCandidates.filter(c => c.tier === "tier_2").length,
          tier3Count: runCandidates.filter(c => c.tier === "tier_3").length,
          uniqueCount: runCandidates.filter(c => c.duplicateClass === "unique").length,
          possibleDuplicateCount: runCandidates.filter(c => c.duplicateClass === "possible_duplicate").length,
          confirmedDuplicateCount: runCandidates.filter(c => c.duplicateClass === "confirmed_duplicate").length,
          tasksCreated,
          taskGenerationRate: approved > 0 ? (tasksCreated / approved) * 100 : 0,
          duplicateRate: totalCandidates > 0 ? (runCandidates.filter(c => c.duplicateClass !== "unique").length / totalCandidates) * 100 : 0,
        };
      });

      // ICP-level aggregation for bar chart
      const icpMap = new Map<string, { icpId: string; icpName: string; total: number; approved: number; duplicates: number }>();
      for (const row of rows) {
        if (!row.icpProfileId) continue;
        const icp = (allIcps as schema.IcpProfile[]).find(i => i.id === row.icpProfileId);
        const key = row.icpProfileId;
        const existing = icpMap.get(key) ?? { icpId: key, icpName: icp?.name ?? "Unknown ICP", total: 0, approved: 0, duplicates: 0 };
        existing.total += row.totalCandidates;
        existing.approved += row.approved;
        existing.duplicates += row.possibleDuplicateCount + row.confirmedDuplicateCount;
        icpMap.set(key, existing);
      }
      const icpRows = Array.from(icpMap.values()).map((i) => ({
        ...i,
        approvalRate: i.total > 0 ? (i.approved / i.total) * 100 : 0,
        duplicateRate: i.total > 0 ? (i.duplicates / i.total) * 100 : 0,
      }));

      type ReportRow = typeof rows[number];
      const totalsApproved = rows.reduce((s: number, r: ReportRow) => s + r.approved, 0);
      const totalsTotal = rows.reduce((s: number, r: ReportRow) => s + r.totalCandidates, 0);
      const totalsTasks = rows.reduce((s: number, r: ReportRow) => s + r.tasksCreated, 0);
      const totals = {
        totalCandidates: totalsTotal,
        reviewed: rows.reduce((s: number, r: ReportRow) => s + r.reviewed, 0),
        approved: totalsApproved,
        rejected: rows.reduce((s: number, r: ReportRow) => s + r.rejected, 0),
        deferred: rows.reduce((s: number, r: ReportRow) => s + r.deferred, 0),
        tasksCreated: totalsTasks,
        conversionRate: totalsTotal > 0 ? (totalsApproved / totalsTotal) * 100 : 0,
        taskGenerationRate: totalsApproved > 0 ? (totalsTasks / totalsApproved) * 100 : 0,
      };

      type StaleDeferredRow = {
        candidate: schema.CandidateLead;
        account: schema.CandidateAccount | null;
        run: schema.LeadGenerationRun | null;
      };
      const staleDeferred = (staleDeferredRaw as StaleDeferredRow[]).map(r => ({
        id: r.candidate.id,
        accountName: r.account?.name ?? "—",
        runName: r.run?.name ?? "—",
        deferredDaysAgo: Math.floor((Date.now() - new Date(r.candidate.updatedAt).getTime()) / (1000 * 60 * 60 * 24)),
      }));

      return res.json({ rows, totals, icpRows, staleDeferred });
    } catch (err) {
      console.error(err);
      return res.status(500).json({ error: "Failed to fetch reports" });
    }
  });


  app.get("/api/lead-gen/audit-events", authenticate, requireRole("Admin", "SalesManager", "SalesRep", "ReadOnly", "SalesOperator", "Reviewer"), readRateLimiter, async (req: AuthRequest, res) => {
    try {
      const { runId } = req.query as { runId?: string };
      const events = await db.select().from(schema.lgAuditEvents)
        .where(runId ? eq(schema.lgAuditEvents.runId, runId) : undefined)
        .orderBy(desc(schema.lgAuditEvents.createdAt))
        .limit(200);
      return res.json(events);
    } catch (err) {
      return res.status(500).json({ error: "Failed to fetch audit events" });
    }
  });


  app.get("/api/lead-gen/runs/:id/agent-logs", authenticate, requireRole("Admin", "SalesManager", "SalesRep", "ReadOnly", "SalesOperator", "Reviewer"), readRateLimiter, async (req: AuthRequest, res) => {
    try {
      const logs = await db.select().from(schema.agentStepLogs)
        .where(eq(schema.agentStepLogs.runId, req.params.id))
        .orderBy(desc(schema.agentStepLogs.createdAt))
        .limit(500);
      return res.json(logs);
    } catch (err) {
      return res.status(500).json({ error: "Failed to fetch agent step logs" });
    }
  });


  app.get("/api/lead-gen/ai-configs", authenticate, requireRole("Admin", "SalesManager"), readRateLimiter, async (req: AuthRequest, res) => {
    try {
      const configs = await db.select({
        id: schema.aiConfigs.id,
        name: schema.aiConfigs.name,
        provider: schema.aiConfigs.provider,
        model: schema.aiConfigs.model,
        apiKeyEnvVar: schema.aiConfigs.apiKeyEnvVar,
        baseUrl: schema.aiConfigs.baseUrl,
        temperature: schema.aiConfigs.temperature,
        maxTokens: schema.aiConfigs.maxTokens,
        agentPhase: schema.aiConfigs.agentPhase,
        isDefault: schema.aiConfigs.isDefault,
        isActive: schema.aiConfigs.isActive,
        createdAt: schema.aiConfigs.createdAt,
        updatedAt: schema.aiConfigs.updatedAt,
      }).from(schema.aiConfigs).orderBy(desc(schema.aiConfigs.createdAt));
      return res.json(configs);
    } catch (err) {
      return res.status(500).json({ error: "Failed to fetch AI configs" });
    }
  });

  app.post("/api/lead-gen/ai-configs", authenticate, requireRole("Admin"), crudRateLimiter, async (req: AuthRequest, res) => {
    try {
      const data = insertAiConfigSchema.parse({ ...req.body, createdBy: req.user?.id });
      if (data.isDefault) {
        await db.update(schema.aiConfigs).set({ isDefault: false, updatedAt: new Date() });
      }
      const result = await db.insert(schema.aiConfigs).values(data).returning();
      await createLgAudit(req.user?.id, "ai_config_created", "AiConfig", result[0].id, null, { name: result[0].name, provider: result[0].provider, model: result[0].model });
      return res.json(result[0]);
    } catch (err) {
      if (err instanceof z.ZodError) return res.status(400).json({ error: "Validation failed", details: err.errors });
      return res.status(500).json({ error: "Failed to create AI config" });
    }
  });

  const aiConfigPatchSchema = z.object({
    name: z.string().min(1).optional(),
    provider: z.string().optional(),
    model: z.string().optional(),
    apiKeyEnvVar: z.string().optional().nullable(),
    baseUrl: z.string().optional().nullable(),
    temperature: z.string().optional().nullable(),
    maxTokens: z.number().int().optional().nullable(),
    agentPhase: z.string().optional().nullable(),
    isDefault: z.boolean().optional(),
    isActive: z.boolean().optional(),
    metadata: z.record(z.unknown()).optional().nullable(),
  });

  app.patch("/api/lead-gen/ai-configs/:id", authenticate, requireRole("Admin"), crudRateLimiter, async (req: AuthRequest, res) => {
    try {
      const parsed = aiConfigPatchSchema.safeParse(req.body);
      if (!parsed.success) return res.status(400).json({ error: "Invalid fields", details: parsed.error.errors });
      if (parsed.data.isDefault) {
        await db.update(schema.aiConfigs).set({ isDefault: false, updatedAt: new Date() });
      }
      const result = await db.update(schema.aiConfigs)
        .set({ ...parsed.data, updatedAt: new Date() })
        .where(eq(schema.aiConfigs.id, req.params.id))
        .returning();
      if (!result[0]) return res.status(404).json({ error: "AI config not found" });
      await createLgAudit(req.user?.id, "ai_config_updated", "AiConfig", req.params.id, null, parsed.data as Record<string, unknown>);
      return res.json(result[0]);
    } catch (err) {
      return res.status(500).json({ error: "Failed to update AI config" });
    }
  });

  app.delete("/api/lead-gen/ai-configs/:id", authenticate, requireRole("Admin"), crudRateLimiter, async (req: AuthRequest, res) => {
    try {
      await db.delete(schema.aiConfigs).where(eq(schema.aiConfigs.id, req.params.id));
      await createLgAudit(req.user?.id, "ai_config_deleted", "AiConfig", req.params.id, null, {});
      return res.json({ success: true });
    } catch (err) {
      return res.status(500).json({ error: "Failed to delete AI config" });
    }
  });

  // Run-specific audit events (with optional actor info)
  app.get("/api/lead-gen/runs/:id/audit-events", authenticate, requireRole("Admin", "SalesManager", "SalesRep", "ReadOnly", "SalesOperator", "Reviewer"), readRateLimiter, async (req: AuthRequest, res) => {
    try {
      const events = await db.select({
        id: schema.lgAuditEvents.id,
        eventType: schema.lgAuditEvents.eventType,
        entityType: schema.lgAuditEvents.entityType,
        entityId: schema.lgAuditEvents.entityId,
        runId: schema.lgAuditEvents.runId,
        details: schema.lgAuditEvents.details,
        createdAt: schema.lgAuditEvents.createdAt,
        actorId: schema.lgAuditEvents.actorId,
        actorName: schema.users.name,
      })
        .from(schema.lgAuditEvents)
        .leftJoin(schema.users, eq(schema.lgAuditEvents.actorId, schema.users.id))
        .where(eq(schema.lgAuditEvents.runId, req.params.id))
        .orderBy(schema.lgAuditEvents.createdAt)
        .limit(500);
      return res.json(events);
    } catch (err) {
      return res.status(500).json({ error: "Failed to fetch run audit events" });
    }
  });

  // Per-run summary metrics for reports page (includes avg ICP fit score, time-to-first-promotion)
  app.get("/api/lead-gen/reports/run-cards", authenticate, requireRole("Admin", "SalesManager", "SalesRep", "ReadOnly", "SalesOperator", "Reviewer"), readRateLimiter, async (req: AuthRequest, res) => {
    try {
      const runs = await db.select().from(schema.leadGenerationRuns).orderBy(desc(schema.leadGenerationRuns.createdAt)).limit(50);

      const runCards = await Promise.all(runs.map(async (run) => {
        // Get candidates for this run with scores
        const candidates = await db.select({
          id: schema.candidateLeads.id,
          status: schema.candidateLeads.status,
          reviewedAt: schema.candidateLeads.reviewedAt,
          createdAt: schema.candidateLeads.createdAt,
        }).from(schema.candidateLeads).where(eq(schema.candidateLeads.runId, run.id));

        const candidateIds = candidates.map(c => c.id);
        let avgIcpFitScore: number | null = null;

        if (candidateIds.length > 0) {
          const scores = await db.select({
            candidateLeadId: schema.candidateScores.candidateLeadId,
            totalScore: schema.candidateScores.totalScore,
            maxScore: schema.candidateScores.maxScore,
          }).from(schema.candidateScores)
            .where(inArray(schema.candidateScores.candidateLeadId, candidateIds));

          if (scores.length > 0) {
            const normalized = scores.map(s => s.maxScore > 0 ? (s.totalScore / s.maxScore) * 100 : 0);
            avgIcpFitScore = Math.round(normalized.reduce((a, b) => a + b, 0) / normalized.length);
          }
        }

        // Time to first promotion: startedAt → first approved reviewedAt
        let timeToFirstPromotion: number | null = null;
        if (run.startedAt) {
          const firstApproved = candidates
            .filter(c => c.status === "approved" && c.reviewedAt)
            .sort((a, b) => new Date(a.reviewedAt!).getTime() - new Date(b.reviewedAt!).getTime())[0];
          if (firstApproved?.reviewedAt) {
            const diffMs = new Date(firstApproved.reviewedAt).getTime() - new Date(run.startedAt).getTime();
            timeToFirstPromotion = Math.max(0, Math.round(diffMs / (1000 * 60))); // minutes
          }
        }

        const approved = candidates.filter(c => c.status === "approved").length;
        const rejected = candidates.filter(c => c.status === "rejected").length;
        const deferred = candidates.filter(c => c.status === "deferred").length;
        const total = candidates.length;
        const approvalRate = total > 0 ? Math.round((approved / total) * 100) : 0;

        return {
          runId: run.id,
          runName: run.name,
          status: run.status,
          startedAt: run.startedAt,
          completedAt: run.completedAt,
          createdAt: run.createdAt,
          totalCandidates: total,
          approved,
          rejected,
          deferred,
          approvalRate,
          avgIcpFitScore,
          timeToFirstPromotion,
        };
      }));

      return res.json(runCards);
    } catch (err) {
      console.error(err);
      return res.status(500).json({ error: "Failed to fetch run cards" });
    }
  });

  // Inline duplicate check for a candidate - checks against CRM accounts, contacts, leads
  app.get("/api/lead-gen/candidates/:id/duplicate-check", authenticate, requireRole("Admin", "SalesManager", "SalesRep", "ReadOnly", "SalesOperator", "Reviewer"), readRateLimiter, async (req: AuthRequest, res) => {
    try {
      const candidate = await db.select().from(schema.candidateLeads).where(eq(schema.candidateLeads.id, req.params.id)).limit(1);
      if (!candidate[0]) return res.status(404).json({ error: "Candidate not found" });

      const matches: Array<{ type: string; id: string; name: string; matchedOn: string }> = [];

      let account: schema.CandidateAccount | null = null;
      let contact: schema.CandidateContact | null = null;

      if (candidate[0].candidateAccountId) {
        const acctRows = await db.select().from(schema.candidateAccounts).where(eq(schema.candidateAccounts.id, candidate[0].candidateAccountId!)).limit(1);
        account = acctRows[0] || null;
      }
      if (candidate[0].candidateContactId) {
        const contRows = await db.select().from(schema.candidateContacts).where(eq(schema.candidateContacts.id, candidate[0].candidateContactId!)).limit(1);
        contact = contRows[0] || null;
      }

      // Check by email
      if (contact?.email) {
        const emailMatchLeads = await db.select({ id: schema.leads.id, firstName: schema.leads.firstName, lastName: schema.leads.lastName }).from(schema.leads).where(eq(schema.leads.email, contact.email)).limit(3);
        for (const l of emailMatchLeads) {
          matches.push({ type: "Lead", id: l.id, name: `${l.firstName} ${l.lastName}`, matchedOn: "email" });
        }
        const emailMatchContacts = await db.select({ id: schema.contacts.id, firstName: schema.contacts.firstName, lastName: schema.contacts.lastName }).from(schema.contacts).where(eq(schema.contacts.email, contact.email)).limit(3);
        for (const c of emailMatchContacts) {
          matches.push({ type: "Contact", id: c.id, name: `${c.firstName} ${c.lastName}`, matchedOn: "email" });
        }
      }

      // Check by company name
      if (account?.name && matches.length === 0) {
        const nameMatchAccounts = await db.select({ id: schema.accounts.id, name: schema.accounts.name }).from(schema.accounts)
          .where(sql`lower(${schema.accounts.name}) = lower(${account.name})`).limit(3);
        for (const a of nameMatchAccounts) {
          matches.push({ type: "Account", id: a.id, name: a.name, matchedOn: "name" });
        }
      }

      // Check by domain
      if (account?.website && matches.length === 0) {
        const domain = account.website.replace(/^https?:\/\//i, "").replace(/^www\./i, "").split("/")[0].toLowerCase();
        if (domain) {
          const domainMatchAccounts = await db.select({ id: schema.accounts.id, name: schema.accounts.name, website: schema.accounts.website }).from(schema.accounts)
            .where(sql`lower(${schema.accounts.website}) like ${"%" + domain + "%"}`).limit(3);
          for (const a of domainMatchAccounts) {
            matches.push({ type: "Account", id: a.id, name: a.name, matchedOn: "domain" });
          }
        }
      }

      return res.json({
        candidateId: req.params.id,
        duplicateClass: candidate[0].duplicateClass,
        matches: matches.slice(0, 5),
      });
    } catch (err) {
      console.error(err);
      return res.status(500).json({ error: "Failed to check duplicates" });
    }
  });

  // ========== AGENT STEP LOGS ==========

  app.get("/api/lead-gen/runs/:id/agent-logs", authenticate, requireRole("Admin", "SalesManager", "SalesRep", "ReadOnly", "SalesOperator", "Reviewer"), readRateLimiter, async (req: AuthRequest, res) => {
    try {
      const logs = await db.select().from(schema.agentStepLogs)
        .where(eq(schema.agentStepLogs.runId, req.params.id))
        .orderBy(desc(schema.agentStepLogs.createdAt))
        .limit(500);
      return res.json(logs);
    } catch (err) {
      return res.status(500).json({ error: "Failed to fetch agent step logs" });
    }
  });

  // ========== AI CONFIGS ==========

  app.get("/api/lead-gen/ai-configs", authenticate, requireRole("Admin", "SalesManager"), readRateLimiter, async (req: AuthRequest, res) => {
    try {
      const configs = await db.select({
        id: schema.aiConfigs.id,
        name: schema.aiConfigs.name,
        provider: schema.aiConfigs.provider,
        model: schema.aiConfigs.model,
        apiKeyEnvVar: schema.aiConfigs.apiKeyEnvVar,
        baseUrl: schema.aiConfigs.baseUrl,
        temperature: schema.aiConfigs.temperature,
        maxTokens: schema.aiConfigs.maxTokens,
        agentPhase: schema.aiConfigs.agentPhase,
        isDefault: schema.aiConfigs.isDefault,
        isActive: schema.aiConfigs.isActive,
        createdAt: schema.aiConfigs.createdAt,
        updatedAt: schema.aiConfigs.updatedAt,
      }).from(schema.aiConfigs).orderBy(desc(schema.aiConfigs.createdAt));
      return res.json(configs);
    } catch (err) {
      return res.status(500).json({ error: "Failed to fetch AI configs" });
    }
  });

  app.post("/api/lead-gen/ai-configs", authenticate, requireRole("Admin"), crudRateLimiter, async (req: AuthRequest, res) => {
    try {
      const data = insertAiConfigSchema.parse({ ...req.body, createdBy: req.user?.id });
      if (data.isDefault) {
        await db.update(schema.aiConfigs).set({ isDefault: false, updatedAt: new Date() });
      }
      const result = await db.insert(schema.aiConfigs).values(data).returning();
      await createLgAudit(req.user?.id, "ai_config_created", "AiConfig", result[0].id, null, { name: result[0].name, provider: result[0].provider, model: result[0].model });
      return res.json(result[0]);
    } catch (err) {
      if (err instanceof z.ZodError) return res.status(400).json({ error: "Validation failed", details: err.errors });
      return res.status(500).json({ error: "Failed to create AI config" });
    }
  });

}
