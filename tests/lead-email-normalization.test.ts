/**
 * Lead email normalization tests.
 *
 * Covers the business rule:
 *   - NULL, empty-string, and whitespace-only emails mean "no email" and
 *     do NOT participate in uniqueness — multiple such leads are allowed in
 *     the same organization.
 *   - Meaningful emails are trimmed of surrounding whitespace before storage.
 *   - Uniqueness is enforced case-insensitively, after trimming, within an org.
 *   - The same meaningful email in different organizations is allowed.
 *
 * Tests span three layers:
 *   1. normalizeEmail() unit tests
 *   2. Storage layer (createLead / updateLead / patchLead) via direct calls
 *   3. External API (POST /leads, PATCH /leads/:id) via HTTP
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { db, storage } from "../server/db";
import { generateApiKey } from "../server/api-key-utils";
import { normalizeEmail } from "../server/lib/normalize-email";
import * as schema from "@shared/schema";
import { eq, inArray } from "drizzle-orm";

const BASE = "http://localhost:5000/api/v1/external";

// ─────────────────────────────────────────────────────────────────────────────
// Test fixtures
// ─────────────────────────────────────────────────────────────────────────────

let orgId: string;
let org2Id: string;
let userId: string;
let orgKey: string;
let org2Key: string;
let keyIds: string[] = [];
let createdLeadIds: string[] = [];

const ts = Date.now();

beforeAll(async () => {
  const orgs = await db.select().from(schema.organizations).limit(2);
  expect(orgs.length).toBeGreaterThanOrEqual(1);
  orgId = orgs[0].id;
  org2Id = orgs.length >= 2 ? orgs[1].id : orgs[0].id; // fall back if only one org

  const users = await db.select().from(schema.users).limit(1);
  expect(users.length).toBeGreaterThan(0);
  userId = users[0].id;

  const k1 = generateApiKey();
  const k2 = generateApiKey();
  orgKey = k1.publicKey;
  org2Key = k2.publicKey;

  const inserted = await db.insert(schema.apiKeys).values([
    { hashedKey: k1.hashedKey, name: `vitest-norm-key1-${ts}`, isActive: true, organizationId: orgId, createdBy: userId },
    { hashedKey: k2.hashedKey, name: `vitest-norm-key2-${ts}`, isActive: true, organizationId: org2Id, createdBy: userId },
  ]).returning({ id: schema.apiKeys.id });
  keyIds = inserted.map(r => r.id);
});

afterAll(async () => {
  if (createdLeadIds.length > 0) {
    await db.delete(schema.leads).where(inArray(schema.leads.id, createdLeadIds));
  }
  if (keyIds.length > 0) {
    await db.delete(schema.apiKeys).where(inArray(schema.apiKeys.id, keyIds));
  }
});

function postLead(body: Record<string, unknown>, key = orgKey) {
  return fetch(`${BASE}/leads`, {
    method: "POST",
    headers: { "x-api-key": key, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

function patchLead(id: string, body: Record<string, unknown>, key = orgKey) {
  return fetch(`${BASE}/leads/${id}`, {
    method: "PATCH",
    headers: { "x-api-key": key, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// 1. normalizeEmail() unit tests
// ─────────────────────────────────────────────────────────────────────────────

describe("normalizeEmail (unit)", () => {
  it("returns null for null", () => {
    expect(normalizeEmail(null)).toBeNull();
  });

  it("returns null for undefined", () => {
    expect(normalizeEmail(undefined)).toBeNull();
  });

  it("returns null for empty string", () => {
    expect(normalizeEmail("")).toBeNull();
  });

  it("returns null for single space", () => {
    expect(normalizeEmail(" ")).toBeNull();
  });

  it("returns null for multi-space whitespace", () => {
    expect(normalizeEmail("   ")).toBeNull();
  });

  it("returns null for tab-only whitespace", () => {
    expect(normalizeEmail("\t")).toBeNull();
  });

  it("trims leading whitespace from a meaningful email", () => {
    expect(normalizeEmail("  jay@example.com")).toBe("jay@example.com");
  });

  it("trims trailing whitespace from a meaningful email", () => {
    expect(normalizeEmail("jay@example.com  ")).toBe("jay@example.com");
  });

  it("trims surrounding whitespace from a meaningful email", () => {
    expect(normalizeEmail("  jay@example.com  ")).toBe("jay@example.com");
  });

  it("preserves case in a meaningful email (case-folding is the DB's job)", () => {
    expect(normalizeEmail("  JAY@EXAMPLE.COM  ")).toBe("JAY@EXAMPLE.COM");
  });

  it("is idempotent — already normalized input is unchanged", () => {
    expect(normalizeEmail("jay@example.com")).toBe("jay@example.com");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 2. Storage layer normalization
// ─────────────────────────────────────────────────────────────────────────────

describe("Storage layer — createLead email normalization", () => {
  it("stores blank email as NULL", async () => {
    const lead = await storage.createLead({
      firstName: "Blank",
      lastName: `Email-${ts}`,
      email: "" as any, // explicit blank
      organizationId: orgId,
      status: "new",
    } as any);
    createdLeadIds.push(lead.id);
    expect(lead.email).toBeNull();

    // Verify round-trip from DB
    const fetched = await db.select().from(schema.leads).where(eq(schema.leads.id, lead.id));
    expect(fetched[0].email).toBeNull();
  });

  it("stores whitespace-only email as NULL", async () => {
    const lead = await storage.createLead({
      firstName: "Whitespace",
      lastName: `Email-${ts}`,
      email: "   " as any,
      organizationId: orgId,
      status: "new",
    } as any);
    createdLeadIds.push(lead.id);
    expect(lead.email).toBeNull();
  });

  it("trims and stores padded meaningful email", async () => {
    const lead = await storage.createLead({
      firstName: "Padded",
      lastName: `Email-${ts}`,
      email: `  padded-${ts}@example.com  ` as any,
      organizationId: orgId,
      status: "new",
    } as any);
    createdLeadIds.push(lead.id);
    expect(lead.email).toBe(`padded-${ts}@example.com`);
  });

  it("preserves null email as null", async () => {
    const lead = await storage.createLead({
      firstName: "Null",
      lastName: `Email-${ts}`,
      email: null,
      organizationId: orgId,
      status: "new",
    } as any);
    createdLeadIds.push(lead.id);
    expect(lead.email).toBeNull();
  });
});

describe("Storage layer — updateLead email normalization", () => {
  it("normalizes blank email to NULL when email key is present in update", async () => {
    const lead = await storage.createLead({
      firstName: "UpdateTest",
      lastName: `Norm-${ts}`,
      email: `update-norm-${ts}@example.com`,
      organizationId: orgId,
      status: "new",
    } as any);
    createdLeadIds.push(lead.id);

    const updated = await storage.updateLead(lead.id, { email: "" } as any);
    expect(updated.email).toBeNull();
  });

  it("does not touch email when email key is absent from update", async () => {
    const lead = await storage.createLead({
      firstName: "UpdateNoEmail",
      lastName: `Norm-${ts}`,
      email: `no-email-change-${ts}@example.com`,
      organizationId: orgId,
      status: "new",
    } as any);
    createdLeadIds.push(lead.id);

    const updated = await storage.updateLead(lead.id, { firstName: "UpdatedName" } as any);
    expect(updated.email).toBe(`no-email-change-${ts}@example.com`);
  });
});

describe("Storage layer — patchLead email normalization", () => {
  it("normalizes blank email to NULL in patchLead", async () => {
    const lead = await storage.createLead({
      firstName: "PatchTest",
      lastName: `Norm-${ts}`,
      email: `patch-norm-${ts}@example.com`,
      organizationId: orgId,
      status: "new",
    } as any);
    createdLeadIds.push(lead.id);

    const patched = await storage.patchLead(lead.id, orgId, { email: "" });
    expect(patched?.email).toBeNull();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 3. External API — POST /leads
// ─────────────────────────────────────────────────────────────────────────────

describe("External API — POST /leads email normalization", () => {
  it("allows multiple leads with no email in the same organization", async () => {
    // Lead 1 — no email field
    const r1 = await postLead({ firstName: "NoEmail1", lastName: `Norm-${ts}`, company: "A" });
    expect(r1.status).toBe(201);
    const b1 = await r1.json() as any;
    createdLeadIds.push(b1.data.id);

    // Lead 2 — also no email
    const r2 = await postLead({ firstName: "NoEmail2", lastName: `Norm-${ts}`, company: "B" });
    expect(r2.status).toBe(201);
    const b2 = await r2.json() as any;
    createdLeadIds.push(b2.data.id);

    expect(b1.data.id).not.toBe(b2.data.id);
  });

  it("deduplicates case-insensitively (exact email, different case)", async () => {
    const email = `case-norm-${ts}@example.com`;
    const r1 = await postLead({ firstName: "CaseA", lastName: `Norm-${ts}`, email });
    expect(r1.status).toBe(201);
    const b1 = await r1.json() as any;
    createdLeadIds.push(b1.data.id);

    const r2 = await postLead({ firstName: "CaseB", lastName: `Norm-${ts}`, email: email.toUpperCase() });
    expect(r2.status).toBe(200);
    const b2 = await r2.json() as any;
    expect(b2.duplicate).toBe(true);
    expect(b2.data.id).toBe(b1.data.id);
  });

  it("deduplicates a whitespace-padded email that matches a stored email", async () => {
    const email = `padded-dedup-${ts}@example.com`;
    const r1 = await postLead({ firstName: "PaddedA", lastName: `Norm-${ts}`, email });
    expect(r1.status).toBe(201);
    const b1 = await r1.json() as any;
    createdLeadIds.push(b1.data.id);

    // Padded + uppercased — Zod .trim() handles the trim, dedup check handles the case
    const r2 = await postLead({ firstName: "PaddedB", lastName: `Norm-${ts}`, email: `  ${email.toUpperCase()}  ` });
    expect(r2.status).toBe(200);
    const b2 = await r2.json() as any;
    expect(b2.duplicate).toBe(true);
    expect(b2.data.id).toBe(b1.data.id);
  });

  it("allows the same email in a different organization", async () => {
    const email = `cross-org-${ts}@example.com`;
    const r1 = await postLead({ firstName: "CrossA", lastName: `Norm-${ts}`, email }, orgKey);
    expect(r1.status).toBe(201);
    const b1 = await r1.json() as any;
    createdLeadIds.push(b1.data.id);

    if (org2Id !== orgId) {
      const r2 = await postLead({ firstName: "CrossB", lastName: `Norm-${ts}`, email }, org2Key);
      expect(r2.status).toBe(201);
      const b2 = await r2.json() as any;
      createdLeadIds.push(b2.data.id);
      expect(b2.data.id).not.toBe(b1.data.id);
    }
  });

  it("stores a trimmed email (padded input, stored trimmed)", async () => {
    const baseEmail = `trimmed-store-${ts}@example.com`;
    const r = await postLead({ firstName: "Trimmed", lastName: `Norm-${ts}`, email: `  ${baseEmail}  ` });
    expect(r.status).toBe(201);
    const body = await r.json() as any;
    createdLeadIds.push(body.data.id);
    // The response reflects the stored (trimmed) value
    expect(body.data.email).toBe(baseEmail);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 4. External API — PATCH /leads/:id
// ─────────────────────────────────────────────────────────────────────────────

describe("External API — PATCH /leads/:id email normalization", () => {
  let patchLeadId: string;

  beforeAll(async () => {
    const r = await postLead({
      firstName: "PatchNorm",
      lastName: `Subject-${ts}`,
      email: `patch-subject-${ts}@example.com`,
    });
    expect(r.status).toBe(201);
    const body = await r.json() as any;
    patchLeadId = body.data.id;
    createdLeadIds.push(patchLeadId);
  });

  it("clears email when patched with null", async () => {
    const r = await patchLead(patchLeadId, { email: null });
    expect(r.status).toBe(200);
    const body = await r.json() as any;
    expect(body.data.email).toBeNull();
  });

  it("rejects blank email string (Zod .trim().email() validates format)", async () => {
    // Blank/whitespace-only email fails Zod .email() after trimming
    const r = await patchLead(patchLeadId, { email: "   " });
    expect(r.status).toBe(400);
  });

  it("accepts and trims a padded valid email", async () => {
    const newEmail = `patched-norm-${ts}@example.com`;
    const r = await patchLead(patchLeadId, { email: `  ${newEmail}  ` });
    expect(r.status).toBe(200);
    const body = await r.json() as any;
    expect(body.data.email).toBe(newEmail);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 5. DB index behaviour — verify uniqueness semantics directly
// ─────────────────────────────────────────────────────────────────────────────

describe("DB index — uniqueness semantics", () => {
  const baseEmail = `db-index-${ts}@example.com`;
  let firstId: string;

  it("index allows multiple NULL-email leads in same org", async () => {
    // Insert two leads with explicit null email via storage layer
    const l1 = await storage.createLead({
      firstName: "IndexNull1", lastName: `Idx-${ts}`, email: null, organizationId: orgId, status: "new",
    } as any);
    const l2 = await storage.createLead({
      firstName: "IndexNull2", lastName: `Idx-${ts}`, email: null, organizationId: orgId, status: "new",
    } as any);
    createdLeadIds.push(l1.id, l2.id);
    expect(l1.id).not.toBe(l2.id);
  });

  it("index rejects a duplicate meaningful email in same org", async () => {
    const l1 = await storage.createLead({
      firstName: "DupA", lastName: `Idx-${ts}`, email: baseEmail, organizationId: orgId, status: "new",
    } as any);
    firstId = l1.id;
    createdLeadIds.push(l1.id);

    // Attempt to insert same email (different case) directly into DB to hit the index
    await expect(
      storage.createLead({
        firstName: "DupB", lastName: `Idx-${ts}`, email: baseEmail.toUpperCase(), organizationId: orgId, status: "new",
      } as any)
    ).rejects.toThrow();
  });

  it("index allows the same meaningful email in a different org", async () => {
    if (org2Id === orgId) return; // skip if only one org in test environment
    const l = await storage.createLead({
      firstName: "CrossOrg", lastName: `Idx-${ts}`, email: baseEmail, organizationId: org2Id, status: "new",
    } as any);
    createdLeadIds.push(l.id);
    expect(l.email).toBe(baseEmail);
  });
});
