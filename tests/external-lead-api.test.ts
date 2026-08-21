// Integration tests for the external lead creation API
// Requires the dev server to be running on localhost:5000
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { db, storage } from "../server/db";
import { generateApiKey } from "../server/api-key-utils";
import * as schema from "@shared/schema";
import { eq, like, inArray } from "drizzle-orm";

const BASE = "http://localhost:5000/api/v1/external";

let orgKey: string;
let sysKey: string;
let readOnlyKey: string;
let orgId: string;
let userId: string;
let keyIds: string[] = [];
let createdLeadIds: string[] = [];
let createdTagIds: string[] = [];
let createdActivityIds: string[] = [];
let createdDocumentIds: string[] = [];
let createdLeadGenerationRunIds: string[] = [];
let createdCandidateLeadIds: string[] = [];
let createdLeadGenerationLinkIds: string[] = [];
const testEmail = `vitest-lead-${Date.now()}@example.com`;

beforeAll(async () => {
  const orgs = await db.select().from(schema.organizations).limit(1);
  expect(orgs.length).toBeGreaterThan(0);
  orgId = orgs[0].id;

  const users = await db.select().from(schema.users).limit(1);
  expect(users.length).toBeGreaterThan(0);
  userId = users[0].id;

  const k1 = generateApiKey();
  const k2 = generateApiKey();
  const k3 = generateApiKey();
  orgKey = k1.publicKey;
  sysKey = k2.publicKey;
  readOnlyKey = k3.publicKey;

  const inserted = await db.insert(schema.apiKeys).values([
    { hashedKey: k1.hashedKey, name: "vitest-org-key", isActive: true, organizationId: orgId, createdBy: userId },
    { hashedKey: k2.hashedKey, name: "vitest-system-key", isActive: true, organizationId: null, createdBy: userId },
    { hashedKey: k3.hashedKey, name: "vitest-read-only-key", isActive: true, organizationId: orgId, createdBy: userId, permissions: ["crm.read"] },
  ]).returning({ id: schema.apiKeys.id });
  keyIds = inserted.map(r => r.id);
});

afterAll(async () => {
  if (createdActivityIds.length > 0) {
    await db.delete(schema.activityAssociations).where(inArray(schema.activityAssociations.activityId, createdActivityIds));
    await db.delete(schema.activities).where(inArray(schema.activities.id, createdActivityIds));
  }
  if (createdLeadIds.length > 0) {
    await db.delete(schema.comments).where(inArray(schema.comments.entityId, createdLeadIds));
    await db.delete(schema.entityTags).where(inArray(schema.entityTags.entityId, createdLeadIds));
    await db.delete(schema.auditLogs).where(inArray(schema.auditLogs.resourceId, createdLeadIds));
  }
  if (createdTagIds.length > 0) {
    await db.delete(schema.tags).where(inArray(schema.tags.id, createdTagIds));
  }
  if (createdDocumentIds.length > 0) {
    await db.delete(schema.documents).where(inArray(schema.documents.id, createdDocumentIds));
  }
  if (createdLeadGenerationLinkIds.length > 0) {
    await db.delete(schema.lgCrmLeads).where(inArray(schema.lgCrmLeads.id, createdLeadGenerationLinkIds));
  }
  if (createdCandidateLeadIds.length > 0) {
    await db.delete(schema.candidateLeads).where(inArray(schema.candidateLeads.id, createdCandidateLeadIds));
  }
  if (createdLeadGenerationRunIds.length > 0) {
    await db.delete(schema.leadGenerationRuns).where(inArray(schema.leadGenerationRuns.id, createdLeadGenerationRunIds));
  }
  if (createdLeadIds.length > 0) {
    await db.delete(schema.leads).where(inArray(schema.leads.id, createdLeadIds));
  }
  if (keyIds.length > 0) {
    await db.delete(schema.apiKeys).where(inArray(schema.apiKeys.id, keyIds));
  }
});

function post(body: any, key: string) {
  return request("/leads", key, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

function request(path: string, key: string, init: RequestInit = {}) {
  return fetch(`${BASE}${path}`, {
    ...init,
    headers: { "x-api-key": key, ...(init.headers || {}) },
  });
}

describe("External Lead API", () => {
  it("creates a lead with an org-bound key", async () => {
    const res = await post({
      firstName: "Vitest",
      lastName: "Lead",
      email: testEmail,
      company: "Test Co",
      source: "website",
      topic: "Automated test",
    }, orgKey);
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.duplicate).toBe(false);
    expect(body.data.id).toMatch(/^LEAD-/);
    expect(body.data.organizationId).toBe(orgId);
    expect(body.data.organizationName).toBeTruthy();
    expect(body.data.firstName).toBe("Vitest");
    expect(body.data.source).toBe("website");
    createdLeadIds.push(body.data.id);
  });

  it("returns the existing lead on duplicate email (case-insensitive)", async () => {
    const res = await post({
      firstName: "Other",
      lastName: "Person",
      email: testEmail.toUpperCase(),
    }, orgKey);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.duplicate).toBe(true);
    expect(body.data.id).toBe(createdLeadIds[0]);
  });

  it("never creates two leads for concurrent identical submissions", async () => {
    const raceEmail = `vitest-race-${Date.now()}@example.com`;
    const payload = { firstName: "Race", lastName: "Condition", email: raceEmail };
    const responses = await Promise.all([
      post(payload, orgKey),
      post(payload, orgKey),
      post(payload, orgKey),
    ]);
    const bodies = await Promise.all(responses.map(r => r.json()));

    // No request may fail with a 500
    for (const r of responses) expect([200, 201]).toContain(r.status);

    const created = bodies.filter(b => b.duplicate === false);
    const duplicates = bodies.filter(b => b.duplicate === true);
    expect(created.length).toBe(1);
    expect(duplicates.length).toBe(2);
    for (const d of duplicates) expect(d.data.id).toBe(created[0].data.id);

    // Exactly one row in the database
    const rows = await db.select().from(schema.leads).where(eq(schema.leads.email, raceEmail));
    expect(rows.length).toBe(1);
    createdLeadIds.push(created[0].data.id);
  });

  it("rejects invalid payloads with field-level errors", async () => {
    const res = await post({ firstName: "", email: "not-an-email", source: "bogus" }, orgKey);
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toBe("Validation failed");
    const fields = body.details.map((d: any) => d.field);
    expect(fields).toContain("firstName");
    expect(fields).toContain("lastName");
    expect(fields).toContain("email");
    expect(fields).toContain("source");
  });

  it("rejects unknown fields (strict schema)", async () => {
    const res = await post({ firstName: "A", lastName: "B", organizationId: "hacked-org" }, orgKey);
    expect(res.status).toBe(400);
  });

  it("rejects system (non-org) keys with 403", async () => {
    const res = await post({ firstName: "A", lastName: "B" }, sysKey);
    expect(res.status).toBe(403);
    const body = await res.json();
    expect(body.error).toBe("Organization-bound API key required");
  });

  it("rejects invalid API keys with 401", async () => {
    const res = await post({ firstName: "A", lastName: "B" }, "htcrm_invalidinvalidinvalidinvalidinvalidkey");
    expect(res.status).toBe(401);
  });

  it("reads back a created lead by ID", async () => {
    const res = await fetch(`${BASE}/leads/${createdLeadIds[0]}`, { headers: { "x-api-key": orgKey } });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data.id).toBe(createdLeadIds[0]);
    expect(body.data.email).toBe(testEmail);
  });

  it("returns 404 for a lead in another organization", async () => {
    // Create a lead directly in a different (temp) org and try to fetch it with the org key
    const [tempOrg] = await db.insert(schema.organizations).values({ name: `vitest-temp-org-${Date.now()}`, slug: `vitest-temp-org-${Date.now()}` }).returning();
    const leadId = `LEAD-VITEST-${Date.now()}`;
    await db.insert(schema.leads).values({
      id: leadId,
      firstName: "Cross",
      lastName: "Org",
      organizationId: tempOrg.id,
    });
    try {
      const res = await fetch(`${BASE}/leads/${leadId}`, { headers: { "x-api-key": orgKey } });
      expect(res.status).toBe(404);
    } finally {
      await db.delete(schema.leads).where(eq(schema.leads.id, leadId));
      await db.delete(schema.organizations).where(eq(schema.organizations.id, tempOrg.id));
    }
  });

  it("filters leads by updatedSince", async () => {
    // A timestamp in the past must include the created lead
    const past = new Date(Date.now() - 60 * 60 * 1000).toISOString();
    const resPast = await fetch(`${BASE}/leads?updatedSince=${encodeURIComponent(past)}&limit=1000`, { headers: { "x-api-key": orgKey } });
    expect(resPast.status).toBe(200);
    const bodyPast = await resPast.json();
    expect(bodyPast.data.some((l: any) => l.id === createdLeadIds[0])).toBe(true);

    // A timestamp in the future must exclude everything
    const future = new Date(Date.now() + 60 * 60 * 1000).toISOString();
    const resFuture = await fetch(`${BASE}/leads?updatedSince=${encodeURIComponent(future)}&limit=1000`, { headers: { "x-api-key": orgKey } });
    const bodyFuture = await resFuture.json();
    expect(bodyFuture.data.length).toBe(0);

    // Invalid timestamp → 400
    const resBad = await fetch(`${BASE}/leads?updatedSince=not-a-date`, { headers: { "x-api-key": orgKey } });
    expect(resBad.status).toBe(400);
  });

  it("lists leads scoped to the key's org", async () => {
    const res = await fetch(`${BASE}/leads?limit=1000`, { headers: { "x-api-key": orgKey } });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(Array.isArray(body.data)).toBe(true);
    expect(body.data.every((l: any) => l.organizationId === orgId)).toBe(true);
    expect(body.data.some((l: any) => l.id === createdLeadIds[0])).toBe(true);
  });

  it("archives and restores a lead without removing its history", async () => {
    const email = `vitest-archived-${Date.now()}@example.com`;
    const createRes = await post({
      firstName: "Archive",
      lastName: "Lifecycle",
      email,
      company: "History Preserved Co",
      source: "website",
    }, orgKey);
    expect(createRes.status).toBe(201);
    const created = await createRes.json();
    const leadId = created.data.id;
    createdLeadIds.push(leadId);

    const [tag] = await db.insert(schema.tags).values({
      name: `vitest-archive-tag-${Date.now()}`,
      organizationId: orgId,
      createdBy: userId,
    }).returning({ id: schema.tags.id });
    createdTagIds.push(tag.id);
    await db.insert(schema.entityTags).values({ entity: "Lead", entityId: leadId, tagId: tag.id, createdBy: userId });
    await db.insert(schema.comments).values({
      entity: "Lead",
      entityId: leadId,
      body: "Archive lifecycle must preserve this comment.",
      createdBy: userId,
    });
    const activityId = `ACT-ARCH-${Date.now()}`;
    createdActivityIds.push(activityId);
    await db.insert(schema.activities).values({
      id: activityId,
      organizationId: orgId,
      type: "note",
      subject: "Archive lifecycle activity",
      relatedType: "Lead",
      relatedId: leadId,
    });
    await db.insert(schema.activityAssociations).values({ activityId, entityType: "Lead", entityId: leadId });
    const documentRes = await request("/documents", orgKey, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        title: `Archive lifecycle document ${Date.now()}`,
        documentType: "note",
        canonicalUrl: `https://example.com/archive-history/${leadId}`,
      }),
    });
    expect(documentRes.status).toBe(201);
    const document = await documentRes.json();
    createdDocumentIds.push(document.data.id);
    const linkRes = await request(`/documents/${document.data.id}/links`, orgKey, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ entityType: "lead", entityId: leadId }),
    });
    expect(linkRes.status).toBe(201);
    const [run] = await db.insert(schema.leadGenerationRuns).values({
      name: `Archive preservation run ${Date.now()}`,
      organizationId: orgId,
      createdBy: userId,
    }).returning({ id: schema.leadGenerationRuns.id });
    createdLeadGenerationRunIds.push(run.id);
    const [candidateLead] = await db.insert(schema.candidateLeads).values({
      runId: run.id,
      createdBy: userId,
    }).returning({ id: schema.candidateLeads.id });
    createdCandidateLeadIds.push(candidateLead.id);
    const [leadGenerationLink] = await db.insert(schema.lgCrmLeads).values({
      candidateLeadId: candidateLead.id,
      crmLeadId: leadId,
      runId: run.id,
    }).returning({ id: schema.lgCrmLeads.id });
    createdLeadGenerationLinkIds.push(leadGenerationLink.id);

    const beforeRes = await request(`/leads/${leadId}`, orgKey);
    expect(beforeRes.status).toBe(200);
    const beforeVersion = beforeRes.headers.get("etag");
    expect(beforeVersion).toBeTruthy();

    const archiveRes = await request(`/leads/${leadId}/archive`, orgKey, {
      method: "POST",
      headers: { "if-match": beforeVersion! },
    });
    expect(archiveRes.status).toBe(200);
    const archived = await archiveRes.json();
    expect(archived.alreadyArchived).toBe(false);
    expect(archived.data.archived).toBe(true);
    expect(archived.data.archivedAt).toBeTruthy();
    expect(archived.data.status).toBe("new");
    const archivedVersion = archiveRes.headers.get("etag");
    expect(archivedVersion).toBeTruthy();

    // Repeating the same transition is a no-op, while an old conditional
    // version remains a stale write and must not be accepted.
    const repeatArchive = await request(`/leads/${leadId}/archive`, orgKey, { method: "POST" });
    expect(repeatArchive.status).toBe(200);
    expect((await repeatArchive.json()).alreadyArchived).toBe(true);
    const staleArchive = await request(`/leads/${leadId}/archive`, orgKey, {
      method: "POST",
      headers: { "if-match": beforeVersion! },
    });
    expect(staleArchive.status).toBe(412);

    const detailArchived = await request(`/leads/${leadId}`, orgKey);
    expect(detailArchived.status).toBe(200);
    expect((await detailArchived.json()).data.archived).toBe(true);

    const defaultList = await request(`/leads?email=${encodeURIComponent(email)}`, orgKey);
    expect(defaultList.status).toBe(200);
    expect((await defaultList.json()).data.some((lead: any) => lead.id === leadId)).toBe(false);
    const historyList = await request(`/leads?email=${encodeURIComponent(email)}&includeArchived=true`, orgKey);
    expect(historyList.status).toBe(200);
    expect((await historyList.json()).data.some((lead: any) => lead.id === leadId)).toBe(true);

    const duplicateArchived = await post({ firstName: "Duplicate", lastName: "Archived", email: email.toUpperCase() }, orgKey);
    expect(duplicateArchived.status).toBe(200);
    const duplicateBody = await duplicateArchived.json();
    expect(duplicateBody.duplicate).toBe(true);
    expect(duplicateBody.data.id).toBe(leadId);
    expect(duplicateBody.data.archived).toBe(true);

    const archivedPatch = await request(`/leads/${leadId}`, orgKey, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ company: "Must not be applied" }),
    });
    expect(archivedPatch.status).toBe(409);
    expect((await archivedPatch.json()).code).toBe("LEAD_ARCHIVED");
    // The storage predicate is the race-safe backstop if archival commits
    // between a route's read and its update attempt.
    expect(await storage.patchLead(leadId, orgId, { company: "Storage bypass attempt" })).toBeUndefined();
    const archivedConvert = await request(`/leads/${leadId}/convert`, orgKey, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ createAccount: false, createContact: false, createOpportunity: false }),
    });
    expect(archivedConvert.status).toBe(409);
    expect((await archivedConvert.json()).code).toBe("LEAD_ARCHIVED");
    const afterBlockedActions = await request(`/leads/${leadId}`, orgKey);
    const blockedLead = (await afterBlockedActions.json()).data;
    expect(blockedLead.company).toBe("History Preserved Co");
    expect(blockedLead.status).toBe("new");
    expect(blockedLead.convertedAt).toBeNull();

    const [comment] = await db.select().from(schema.comments).where(eq(schema.comments.entityId, leadId));
    const [entityTag] = await db.select().from(schema.entityTags).where(eq(schema.entityTags.entityId, leadId));
    const [relatedActivity] = await db.select().from(schema.activities).where(eq(schema.activities.relatedId, leadId));
    const [association] = await db.select().from(schema.activityAssociations).where(eq(schema.activityAssociations.entityId, leadId));
    const [documentLink] = await db.select().from(schema.documentLinks).where(eq(schema.documentLinks.entityId, leadId));
    const [persistedLeadGenerationLink] = await db.select().from(schema.lgCrmLeads)
      .where(eq(schema.lgCrmLeads.id, leadGenerationLink.id));
    expect(comment?.body).toBe("Archive lifecycle must preserve this comment.");
    expect(entityTag?.tagId).toBe(tag.id);
    expect(relatedActivity?.id).toBe(activityId);
    expect(association?.activityId).toBe(activityId);
    expect(documentLink?.documentId).toBe(document.data.id);
    expect(persistedLeadGenerationLink?.crmLeadId).toBe(leadId);

    // Record-level audit is asynchronous, so allow the request middleware tick
    // to complete before asserting the archive event.
    await new Promise(resolve => setTimeout(resolve, 50));
    const archiveAudits = await db.select().from(schema.auditLogs)
      .where(eq(schema.auditLogs.resourceId, leadId));
    expect(archiveAudits.some(log => log.action === "external_api_archive_lead")).toBe(true);

    const restoreRes = await request(`/leads/${leadId}/restore`, orgKey, {
      method: "POST",
      headers: { "if-match": archivedVersion! },
    });
    expect(restoreRes.status).toBe(200);
    const restored = await restoreRes.json();
    expect(restored.alreadyActive).toBe(false);
    expect(restored.data.archived).toBe(false);
    expect(restored.data.archivedAt).toBeNull();
    expect(restored.data.status).toBe("new");
    expect(restored.data.email).toBe(email);

    const restoredPatch = await request(`/leads/${leadId}`, orgKey, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ company: "Restored Lifecycle Co" }),
    });
    expect(restoredPatch.status).toBe(200);
    expect((await restoredPatch.json()).data.company).toBe("Restored Lifecycle Co");

    const restoredConvert = await request(`/leads/${leadId}/convert`, orgKey, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ createAccount: false, createContact: false, createOpportunity: false }),
    });
    expect(restoredConvert.status).toBe(201);
    expect((await restoredConvert.json()).data.lead.status).toBe("converted");

    const staleRestore = await request(`/leads/${leadId}/restore`, orgKey, {
      method: "POST",
      headers: { "if-match": beforeVersion! },
    });
    expect(staleRestore.status).toBe(412);

    const repeatRestore = await request(`/leads/${leadId}/restore`, orgKey, { method: "POST" });
    expect(repeatRestore.status).toBe(200);
    expect((await repeatRestore.json()).alreadyActive).toBe(true);
  });

  it("enforces archive input, org isolation, and crm.write", async () => {
    const malformed = await request("/leads/not-a-canonical-id/archive", orgKey, { method: "POST" });
    expect(malformed.status).toBe(400);
    expect((await malformed.json()).code).toBe("VALIDATION_ERROR");
    const malformedRestore = await request("/leads/not-a-canonical-id/restore", orgKey, { method: "POST" });
    expect(malformedRestore.status).toBe(400);

    const missing = await request("/leads/LEAD-999999/archive", orgKey, { method: "POST" });
    expect(missing.status).toBe(404);

    const leadId = `LEAD-${String((Date.now() % 800000) + 100000)}`;
    const [foreignOrg] = await db.insert(schema.organizations).values({
      name: `vitest-archive-foreign-${Date.now()}`,
      slug: `vitest-archive-foreign-${Date.now()}`,
    }).returning();
    await db.insert(schema.leads).values({ id: leadId, firstName: "Foreign", lastName: "Archive", organizationId: foreignOrg.id });
    try {
      const crossOrg = await request(`/leads/${leadId}/archive`, orgKey, { method: "POST" });
      expect(crossOrg.status).toBe(404);
      const crossOrgRestore = await request(`/leads/${leadId}/restore`, orgKey, { method: "POST" });
      expect(crossOrgRestore.status).toBe(404);
    } finally {
      await db.delete(schema.leads).where(eq(schema.leads.id, leadId));
      await db.delete(schema.organizations).where(eq(schema.organizations.id, foreignOrg.id));
    }

    const writeDenied = await request(`/leads/${createdLeadIds[0]}/archive`, readOnlyKey, { method: "POST" });
    expect(writeDenied.status).toBe(403);
    const restoreDenied = await request(`/leads/${createdLeadIds[0]}/restore`, readOnlyKey, { method: "POST" });
    expect(restoreDenied.status).toBe(403);
  });
});
