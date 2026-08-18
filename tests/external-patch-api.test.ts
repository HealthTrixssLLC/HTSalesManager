// Integration tests for the Phase E controlled PATCH API
// Requires the dev server to be running on localhost:5000
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { db } from "../server/db";
import { generateApiKey } from "../server/api-key-utils";
import * as schema from "@shared/schema";
import { eq, inArray } from "drizzle-orm";

const BASE = "http://localhost:5000/api/v1/external";

let orgKey: string;
let readOnlyKey: string;
let orgId: string;
let otherOrgId: string;
let userId: string;
let keyIds: string[] = [];
let inOrgUserId: string;
let outOrgUserId: string;
let createdUserIds: string[] = [];
let membershipIds: string[] = [];

// Test records (created directly in DB, cleaned up after)
const suffix = Date.now();
const ids = {
  account: `ACCT-VITEST-${suffix}`,
  otherAccount: `ACCT-VITEST-OTHER-${suffix}`,
  contact: `CONT-VITEST-${suffix}`,
  lead: `LEAD-VITEST-${suffix}`,
  opportunity: `OPP-VITEST-${suffix}`,
  activity: `ACT-VITEST-${suffix}`,
};

function patch(path: string, body: any, key: string) {
  return fetch(`${BASE}${path}`, {
    method: "PATCH",
    headers: { "x-api-key": key, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

beforeAll(async () => {
  const orgs = await db.select().from(schema.organizations).limit(1);
  expect(orgs.length).toBeGreaterThan(0);
  orgId = orgs[0].id;

  const users = await db.select().from(schema.users).limit(1);
  expect(users.length).toBeGreaterThan(0);
  userId = users[0].id;

  // Second org for isolation tests
  const [tempOrg] = await db.insert(schema.organizations)
    .values({ name: `vitest-patch-org-${suffix}`, slug: `vitest-patch-org-${suffix}` })
    .returning();
  otherOrgId = tempOrg.id;

  // API keys: org-bound full access and read-only (Phase F permission scopes)
  const k1 = generateApiKey();
  const k2 = generateApiKey();
  orgKey = k1.publicKey;
  readOnlyKey = k2.publicKey;
  const inserted = await db.insert(schema.apiKeys).values([
    { hashedKey: k1.hashedKey, name: "vitest-patch-key", isActive: true, organizationId: orgId, createdBy: userId },
    { hashedKey: k2.hashedKey, name: "vitest-patch-key-readonly", isActive: true, organizationId: orgId, createdBy: userId, permissions: ["crm.read", "activities.read", "documents.read"] },
  ]).returning({ id: schema.apiKeys.id });
  keyIds = inserted.map(r => r.id);

  // Users for ownerId membership tests: one member of orgId, one only in otherOrgId
  const roles = await db.select().from(schema.roles).limit(1);
  expect(roles.length).toBeGreaterThan(0);
  const roleId = roles[0].id;
  const insertedUsers = await db.insert(schema.users).values([
    { email: `vitest-in-org-${suffix}@example.com`, name: "Vitest InOrg", password: "x" },
    { email: `vitest-out-org-${suffix}@example.com`, name: "Vitest OutOrg", password: "x" },
  ]).returning({ id: schema.users.id });
  inOrgUserId = insertedUsers[0].id;
  outOrgUserId = insertedUsers[1].id;
  createdUserIds = insertedUsers.map(u => u.id);
  const memberships = await db.insert(schema.userOrganizations).values([
    { userId: inOrgUserId, organizationId: orgId, roleId },
    { userId: outOrgUserId, organizationId: otherOrgId, roleId },
  ]).returning({ id: schema.userOrganizations.id });
  membershipIds = memberships.map(m => m.id);

  // Seed records
  await db.insert(schema.accounts).values([
    { id: ids.account, organizationId: orgId, name: "Vitest Patch Account" },
    { id: ids.otherAccount, organizationId: otherOrgId, name: "Vitest Other-Org Account" },
  ]);
  await db.insert(schema.contacts).values({
    id: ids.contact, organizationId: orgId, firstName: "Patch", lastName: "Contact",
  });
  await db.insert(schema.leads).values({
    id: ids.lead, organizationId: orgId, firstName: "Patch", lastName: "Lead",
  });
  await db.insert(schema.opportunities).values({
    id: ids.opportunity, organizationId: orgId, accountId: ids.account,
    name: "Vitest Patch Opp", closeDate: new Date(),
  });
  await db.insert(schema.activities).values({
    id: ids.activity, organizationId: orgId, type: "task", subject: "Vitest Patch Activity",
  });
});

afterAll(async () => {
  await db.delete(schema.activities).where(eq(schema.activities.id, ids.activity));
  await db.delete(schema.opportunities).where(eq(schema.opportunities.id, ids.opportunity));
  await db.delete(schema.leads).where(eq(schema.leads.id, ids.lead));
  await db.delete(schema.contacts).where(eq(schema.contacts.id, ids.contact));
  await db.delete(schema.accounts).where(inArray(schema.accounts.id, [ids.account, ids.otherAccount]));
  await db.delete(schema.organizations).where(eq(schema.organizations.id, otherOrgId));
  if (keyIds.length > 0) {
    await db.delete(schema.apiKeys).where(inArray(schema.apiKeys.id, keyIds));
  }
  if (membershipIds.length > 0) {
    await db.delete(schema.userOrganizations).where(inArray(schema.userOrganizations.id, membershipIds));
  }
  if (createdUserIds.length > 0) {
    await db.delete(schema.users).where(inArray(schema.users.id, createdUserIds));
  }
});

describe("External PATCH API — valid partial updates", () => {
  it("patches an account (only provided fields change)", async () => {
    const res = await patch(`/accounts/${ids.account}`, { industry: "Healthcare" }, orgKey);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data.industry).toBe("Healthcare");
    expect(body.data.name).toBe("Vitest Patch Account"); // unchanged
  });

  it("patches a contact", async () => {
    const res = await patch(`/contacts/${ids.contact}`, { title: "CTO", email: "patch-contact@example.com" }, orgKey);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data.title).toBe("CTO");
    expect(body.data.email).toBe("patch-contact@example.com");
    expect(body.data.firstName).toBe("Patch"); // unchanged
  });

  it("patches a lead", async () => {
    const res = await patch(`/leads/${ids.lead}`, { status: "contacted", rating: "hot" }, orgKey);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data.status).toBe("contacted");
    expect(body.data.rating).toBe("hot");
  });

  it("patches an opportunity (stage, amount, dates)", async () => {
    const res = await patch(`/opportunities/${ids.opportunity}`, {
      stage: "negotiation",
      amount: 12345.67,
      billingEndDate: "2027-01-31T00:00:00Z",
    }, orgKey);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data.stage).toBe("negotiation");
    expect(Number(body.data.amount)).toBeCloseTo(12345.67);
    expect(body.data.billingEndDate).toBeTruthy();
    expect(body.data.name).toBe("Vitest Patch Opp"); // unchanged
  });

  it("patches an activity", async () => {
    const res = await patch(`/activities/${ids.activity}`, { status: "completed", priority: "high" }, orgKey);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data.status).toBe("completed");
    expect(body.data.priority).toBe("high");
    expect(body.data.subject).toBe("Vitest Patch Activity"); // unchanged
  });
});

describe("External PATCH API — field rejection", () => {
  it("rejects unknown fields with 400 and lists them", async () => {
    const res = await patch(`/accounts/${ids.account}`, { name: "X", bogusField: 1, another: "y" }, orgKey);
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.rejectedFields).toContain("bogusField");
    expect(body.rejectedFields).toContain("another");
  });

  it.each([
    ["id", "HACKED-ID"],
    ["organizationId", "hacked-org"],
    ["createdAt", "2020-01-01T00:00:00Z"],
    ["updatedAt", "2020-01-01T00:00:00Z"],
    ["sourceSystem", "hacked"],
  ])("rejects immutable field %s with 400", async (field, value) => {
    const res = await patch(`/leads/${ids.lead}`, { firstName: "OK", [field]: value }, orgKey);
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toBe("Immutable fields cannot be modified");
    expect(body.rejectedFields).toContain(field);
  });

  it("rejects an empty body with 400", async () => {
    const res = await patch(`/opportunities/${ids.opportunity}`, {}, orgKey);
    expect(res.status).toBe(400);
  });

  it("rejects invalid field values with 400 details", async () => {
    const res = await patch(`/opportunities/${ids.opportunity}`, { stage: "not-a-stage", probability: 500 }, orgKey);
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toBe("Validation failed");
    const fields = body.details.map((d: any) => d.field);
    expect(fields).toContain("stage");
    expect(fields).toContain("probability");
  });
});

describe("External PATCH API — access control", () => {
  it("returns 404 for a missing record", async () => {
    const res = await patch(`/contacts/CONT-DOES-NOT-EXIST`, { title: "X" }, orgKey);
    expect(res.status).toBe(404);
  });

  it("returns 404 when patching another org's record (org isolation)", async () => {
    const res = await patch(`/accounts/${ids.otherAccount}`, { name: "Hijacked" }, orgKey);
    expect(res.status).toBe(404);
    // Verify unchanged in DB
    const [row] = await db.select().from(schema.accounts).where(eq(schema.accounts.id, ids.otherAccount));
    expect(row.name).toBe("Vitest Other-Org Account");
  });

  it("rejects moving a contact to another org's account (cross-tenant accountId)", async () => {
    const res = await patch(`/contacts/${ids.contact}`, { accountId: ids.otherAccount }, orgKey);
    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body.error).toBe("Related account not found");
    const [row] = await db.select().from(schema.contacts).where(eq(schema.contacts.id, ids.contact));
    expect(row.accountId).toBeNull(); // unchanged
  });

  it("rejects moving an opportunity to another org's account (cross-tenant accountId)", async () => {
    const res = await patch(`/opportunities/${ids.opportunity}`, { accountId: ids.otherAccount }, orgKey);
    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body.error).toBe("Related account not found");
    const [row] = await db.select().from(schema.opportunities).where(eq(schema.opportunities.id, ids.opportunity));
    expect(row.accountId).toBe(ids.account); // unchanged
  });

  it("allows linking a contact to a same-org account", async () => {
    const res = await patch(`/contacts/${ids.contact}`, { accountId: ids.account }, orgKey);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data.accountId).toBe(ids.account);
  });

  it("rejects implementation start date after end date (merged state)", async () => {
    const res = await patch(`/opportunities/${ids.opportunity}`, {
      implementationStartDate: "2027-06-01T00:00:00Z",
      implementationEndDate: "2027-01-01T00:00:00Z",
    }, orgKey);
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toMatch(/start date must be before end date/i);
  });

  it("rejects a billing end date before the implementation end date via partial patch", async () => {
    // Set a valid schedule first
    const setup = await patch(`/opportunities/${ids.opportunity}`, {
      implementationStartDate: "2026-01-01T00:00:00Z",
      implementationEndDate: "2026-06-30T00:00:00Z",
      billingEndDate: "2027-06-30T00:00:00Z",
    }, orgKey);
    expect(setup.status).toBe(200);
    // A partial patch of billingEndDate alone must be validated against the merged record
    const res = await patch(`/opportunities/${ids.opportunity}`, {
      billingEndDate: "2026-01-15T00:00:00Z",
    }, orgKey);
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toMatch(/billing end date/i);
  });

  it.each([
    ["accounts", () => ids.account],
    ["contacts", () => ids.contact],
    ["leads", () => ids.lead],
    ["opportunities", () => ids.opportunity],
    ["activities", () => ids.activity],
  ])("rejects assigning %s owner from another organization", async (path, getId) => {
    const res = await patch(`/${path}/${getId()}`, { ownerId: outOrgUserId }, orgKey);
    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body.error).toBe("Related owner not found");
  });

  it("accepts an in-organization member as owner", async () => {
    const res = await patch(`/accounts/${ids.account}`, { ownerId: inOrgUserId }, orgKey);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data.ownerId).toBe(inOrgUserId);
  });

  it("returns 403 for read-only keys (Phase F permission scopes)", async () => {
    const res = await patch(`/accounts/${ids.account}`, { name: "Blocked" }, readOnlyKey);
    expect(res.status).toBe(403);
    const body = await res.json();
    expect(body.error).toBe("Insufficient permissions");
    expect(body.requiredPermission).toBe("crm.write");
  });

  it("returns 401 for an invalid API key", async () => {
    const res = await patch(`/accounts/${ids.account}`, { name: "X" }, "htcrm_invalidinvalidinvalidinvalidinvalidkey");
    expect(res.status).toBe(401);
  });
});

describe("External PATCH API — ETag / stale-write protection", () => {
  function get(path: string, key: string) {
    return fetch(`${BASE}${path}`, { headers: { "x-api-key": key } });
  }
  function patchWithMatch(path: string, body: any, key: string, etag: string) {
    return fetch(`${BASE}${path}`, {
      method: "PATCH",
      headers: { "x-api-key": key, "Content-Type": "application/json", "If-Match": etag },
      body: JSON.stringify(body),
    });
  }

  it("GET detail exposes ETag header and _version field", async () => {
    const res = await get(`/accounts/${ids.account}`, orgKey);
    expect(res.status).toBe(200);
    const etag = res.headers.get("etag");
    expect(etag).toBeTruthy();
    const body = await res.json();
    expect(body.data._version).toBe(etag);
  });

  it("PATCH with matching If-Match succeeds and returns a new version", async () => {
    const getRes = await get(`/contacts/${ids.contact}`, orgKey);
    const etag = getRes.headers.get("etag")!;
    const res = await patchWithMatch(`/contacts/${ids.contact}`, { title: "Versioned Title" }, orgKey, etag);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data.title).toBe("Versioned Title");
    const newTag = res.headers.get("etag");
    expect(newTag).toBeTruthy();
    expect(newTag).not.toBe(etag);
    expect(body.data._version).toBe(newTag);
  });

  it("PATCH with a stale If-Match returns 412 STALE_RECORD", async () => {
    const getRes = await get(`/leads/${ids.lead}`, orgKey);
    const etag = getRes.headers.get("etag")!;
    // Concurrent writer bumps the record
    const first = await patch(`/leads/${ids.lead}`, { title: "Winner Write" }, orgKey);
    expect(first.status).toBe(200);
    // Stale client retries with the old version
    const res = await patchWithMatch(`/leads/${ids.lead}`, { title: "Loser Write" }, orgKey, etag);
    expect(res.status).toBe(412);
    const body = await res.json();
    expect(body.code).toBe("STALE_RECORD");
    expect(body.currentVersion).toBeTruthy();
  });

  it("a rejected stale PATCH leaves the record unchanged", async () => {
    const getRes = await get(`/leads/${ids.lead}`, orgKey);
    const body = await getRes.json();
    expect(body.data.title).toBe("Winner Write");
  });

  it("stale If-Match is rejected even when it races the atomic UPDATE (currentVersion usable for retry)", async () => {
    const getRes = await get(`/opportunities/${ids.opportunity}`, orgKey);
    const etag = getRes.headers.get("etag")!;
    const res = await patchWithMatch(`/opportunities/${ids.opportunity}`, { probability: 55 }, orgKey, etag);
    expect(res.status).toBe(200);
    // Retry with the returned version works
    const resBody = await res.json();
    const retry = await patchWithMatch(`/opportunities/${ids.opportunity}`, { probability: 60 }, orgKey, resBody.data._version);
    expect(retry.status).toBe(200);
    // But the original (now stale) tag is rejected
    const stale = await patchWithMatch(`/opportunities/${ids.opportunity}`, { probability: 65 }, orgKey, etag);
    expect(stale.status).toBe(412);
  });

  it("every successful write changes the version, even in the same millisecond", async () => {
    const tags: string[] = [];
    for (let i = 0; i < 3; i++) {
      const res = await patch(`/accounts/${ids.account}`, { industry: `Rapid-${i}` }, orgKey);
      expect(res.status).toBe(200);
      tags.push(res.headers.get("etag")!);
    }
    expect(new Set(tags).size).toBe(3);
  });

  it("two concurrent conditional PATCHes with the same version: exactly one wins", async () => {
    const getRes = await get(`/contacts/${ids.contact}`, orgKey);
    const etag = getRes.headers.get("etag")!;
    const [a, b] = await Promise.all([
      patchWithMatch(`/contacts/${ids.contact}`, { title: "Racer A" }, orgKey, etag),
      patchWithMatch(`/contacts/${ids.contact}`, { title: "Racer B" }, orgKey, etag),
    ]);
    const statuses = [a.status, b.status].sort();
    expect(statuses).toEqual([200, 412]);
  });

  it("weak ETags never satisfy If-Match (strong comparison)", async () => {
    const getRes = await get(`/accounts/${ids.account}`, orgKey);
    const etag = getRes.headers.get("etag")!;
    const res = await patchWithMatch(`/accounts/${ids.account}`, { industry: "WeakTag" }, orgKey, `W/${etag}`);
    expect(res.status).toBe(412);
    expect((await res.json()).code).toBe("STALE_RECORD");
  });

  it("malformed If-Match values are rejected with 412 (bare/unquoted tokens)", async () => {
    const getRes = await get(`/accounts/${ids.account}`, orgKey);
    const etag = getRes.headers.get("etag")!;
    const bare = etag.replace(/"/g, ""); // response token without required quotes
    // Blank headers and lists containing any malformed member are also rejected,
    // even when a valid matching tag appears alongside the malformed one
    for (const badTag of [bare, `'${bare}'`, `"unterminated`, `""extra"`, " ", `${etag}, ${bare}`, `${etag},`]) {
      const res = await patchWithMatch(`/accounts/${ids.account}`, { industry: "MalformedTag" }, orgKey, badTag);
      expect(res.status).toBe(412);
      expect((await res.json()).code).toBe("STALE_RECORD");
    }
  });

  it("If-Match: * matches any current version", async () => {
    const res = await patchWithMatch(`/accounts/${ids.account}`, { industry: "StarMatch" }, orgKey, "*");
    expect(res.status).toBe(200);
    expect((await res.json()).data.industry).toBe("StarMatch");
  });

  it("internal (non-external) updates also advance the version monotonically", async () => {
    // Rapid external PATCHes can push updated_at ahead of wall-clock time; an
    // internal edit must not move it backward and resurrect an old ETag.
    const beforeRes = await get(`/accounts/${ids.account}`, orgKey);
    const oldTag = beforeRes.headers.get("etag")!;
    // Simulate an internal CRM edit via the storage layer's update path
    const { storage } = await import("../server/db");
    await storage.updateAccount(ids.account, { industry: "InternalEdit" });
    const afterRes = await get(`/accounts/${ids.account}`, orgKey);
    const newTag = afterRes.headers.get("etag")!;
    expect(newTag).not.toBe(oldTag);
    // The pre-internal-edit token must now be stale
    const stale = await patchWithMatch(`/accounts/${ids.account}`, { industry: "OldTokenWrite" }, orgKey, oldTag);
    expect(stale.status).toBe(412);
  });

  it("internal owner reassignment (user merge) invalidates prior versions", async () => {
    const { storage } = await import("../server/db");
    // Give the record an owner that the merge flow will reassign
    await storage.updateOpportunity(ids.opportunity, { ownerId: outOrgUserId });
    const beforeRes = await get(`/opportunities/${ids.opportunity}`, orgKey);
    const oldTag = beforeRes.headers.get("etag")!;
    // Internal admin flow: merge the owner into another user (bulk ownerId rewrite)
    await storage.mergeUsers(inOrgUserId, [outOrgUserId]);
    try {
      const afterRes = await get(`/opportunities/${ids.opportunity}`, orgKey);
      expect(afterRes.headers.get("etag")).not.toBe(oldTag);
      const stale = await patchWithMatch(`/opportunities/${ids.opportunity}`, { probability: 75 }, orgKey, oldTag);
      expect(stale.status).toBe(412);
      expect((await stale.json()).code).toBe("STALE_RECORD");
    } finally {
      await storage.updateOpportunity(ids.opportunity, { ownerId: null as any });
    }
  });

  it("internal opportunity edits with raw-SQL fields (description) invalidate mid-update versions", async () => {
    const { storage } = await import("../server/db");
    const beforeRes = await get(`/opportunities/${ids.opportunity}`, orgKey);
    const oldTag = beforeRes.headers.get("etag")!;
    // updateOpportunity applies description via a second raw-SQL phase; the
    // resulting version must reject any ETag issued before or between phases
    await storage.updateOpportunity(ids.opportunity, { description: "Two-phase update check" });
    const afterRes = await get(`/opportunities/${ids.opportunity}`, orgKey);
    expect(afterRes.headers.get("etag")).not.toBe(oldTag);
    const stale = await patchWithMatch(`/opportunities/${ids.opportunity}`, { probability: 55 }, orgKey, oldTag);
    expect(stale.status).toBe(412);
  });

  it("lead conversion invalidates prior versions", async () => {
    const { storage } = await import("../server/db");
    const beforeRes = await get(`/leads/${ids.lead}`, orgKey);
    const oldTag = beforeRes.headers.get("etag")!;
    await storage.markLeadConverted(ids.lead, { accountId: null, contactId: null, opportunityId: null });
    try {
      const afterRes = await get(`/leads/${ids.lead}`, orgKey);
      expect(afterRes.headers.get("etag")).not.toBe(oldTag);
      const stale = await patchWithMatch(`/leads/${ids.lead}`, { title: "Post-conversion write" }, orgKey, oldTag);
      expect(stale.status).toBe(412);
      expect((await stale.json()).code).toBe("STALE_RECORD");
    } finally {
      await storage.updateLead(ids.lead, { status: "new" });
    }
  });

  it("organization backfill repair invalidates prior versions", async () => {
    const { db } = await import("../server/db");
    const schemaMod = await import("@shared/schema");
    const { backfillEntityOrganizations } = await import("../server/seed");
    const { sql } = await import("drizzle-orm");
    const beforeRes = await get(`/accounts/${ids.account}`, orgKey);
    const oldTag = beforeRes.headers.get("etag")!;
    // The backfill repairs legacy rows that predate org stamping (NULL org).
    // The modern schema forbids NULL, so temporarily relax the constraint to
    // recreate the legacy state this repair path exists for.
    await db.execute(sql`ALTER TABLE accounts ALTER COLUMN organization_id DROP NOT NULL`);
    try {
      await db.update(schemaMod.accounts).set({ organizationId: null as any }).where(eq(schemaMod.accounts.id, ids.account));
      await backfillEntityOrganizations(orgId);
      // Re-stamp to the test org in case the backfill targeted a different primary org
      await db.update(schemaMod.accounts).set({ organizationId: orgId }).where(eq(schemaMod.accounts.id, ids.account));
    } finally {
      await db.execute(sql`ALTER TABLE accounts ALTER COLUMN organization_id SET NOT NULL`);
    }
    const afterRes = await get(`/accounts/${ids.account}`, orgKey);
    expect(afterRes.status).toBe(200);
    expect(afterRes.headers.get("etag")).not.toBe(oldTag);
    const stale = await patchWithMatch(`/accounts/${ids.account}`, { industry: "Post-backfill write" }, orgKey, oldTag);
    expect(stale.status).toBe(412);
  });

  it("PATCH without If-Match still succeeds (backward compatible)", async () => {
    const res = await patch(`/activities/${ids.activity}`, { subject: "No precondition" }, orgKey);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data.subject).toBe("No precondition");
    expect(res.headers.get("etag")).toBeTruthy();
  });
});

describe("External PATCH API — audit logging", () => {
  it("logs the mutation in the audit log", async () => {
    const res = await patch(`/leads/${ids.lead}`, { company: `Audit Co ${suffix}` }, orgKey);
    expect(res.status).toBe(200);
    // Audit write is fire-and-forget; give it a moment
    await new Promise(r => setTimeout(r, 1000));
    const logs = await db.select().from(schema.auditLogs)
      .where(eq(schema.auditLogs.resourceId, ids.lead));
    const patchLog = logs.find(l =>
      l.action === "external_api_patch" && (l.after as any)?.company === `Audit Co ${suffix}`
    );
    expect(patchLog).toBeTruthy();
    expect((patchLog!.before as any)).toHaveProperty("company");
  });
});
