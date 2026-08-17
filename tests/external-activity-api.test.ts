// Integration tests for Phase A — Activity Read API
// (GET /activities, GET /activities/:id)
// Requires the dev server to be running on localhost:5000
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { db } from "../server/db";
import { generateApiKey } from "../server/api-key-utils";
import * as schema from "@shared/schema";
import { eq, inArray } from "drizzle-orm";

const BASE = "http://localhost:5000/api/v1/external";
const suffix = Date.now();

let orgAId: string;
let orgBId: string;
let userId: string;
let keyA: string;        // org A, full permissions
let keyB: string;        // org B, full permissions
let readOnlyKey: string; // org A, activities.read only
let noPermKey: string;   // org A, crm.read only (lacks activities.read)
let sysKey: string;      // system key (no org)
let keyIds: string[] = [];

const HOUR = 3600 * 1000;
const now = Date.now();

const ids = {
  acctA: `ACCT-VTACT-${suffix}`,
  leadA: `LEAD-VTACT-${suffix}`,
  actCall: `ACT-VTACT-CALL-${suffix}`,   // call / pending / high, due in +2h, related Account
  actTask: `ACT-VTACT-TASK-${suffix}`,   // task / completed / low, due at -2h, related Lead
  actNote: `ACT-VTACT-NOTE-${suffix}`,   // note / cancelled / medium, no dueAt, unrelated
  actB: `ACT-VTACT-B-${suffix}`,         // org B activity
};

function get(path: string, key: string = keyA) {
  return fetch(`${BASE}${path}`, { headers: { "x-api-key": key } });
}

beforeAll(async () => {
  const users = await db.select().from(schema.users).limit(1);
  expect(users.length).toBeGreaterThan(0);
  userId = users[0].id;

  const [orgA] = await db.insert(schema.organizations)
    .values({ name: `vitest-act-org-a-${suffix}`, slug: `vitest-act-org-a-${suffix}` }).returning();
  const [orgB] = await db.insert(schema.organizations)
    .values({ name: `vitest-act-org-b-${suffix}`, slug: `vitest-act-org-b-${suffix}` }).returning();
  orgAId = orgA.id;
  orgBId = orgB.id;

  const k1 = generateApiKey();
  const k2 = generateApiKey();
  const k3 = generateApiKey();
  const k4 = generateApiKey();
  const k5 = generateApiKey();
  keyA = k1.publicKey;
  keyB = k2.publicKey;
  readOnlyKey = k3.publicKey;
  noPermKey = k4.publicKey;
  sysKey = k5.publicKey;
  const inserted = await db.insert(schema.apiKeys).values([
    { hashedKey: k1.hashedKey, name: `vitest-act-key-a-${suffix}`, isActive: true, organizationId: orgAId, createdBy: userId },
    { hashedKey: k2.hashedKey, name: `vitest-act-key-b-${suffix}`, isActive: true, organizationId: orgBId, createdBy: userId },
    { hashedKey: k3.hashedKey, name: `vitest-act-key-ro-${suffix}`, isActive: true, organizationId: orgAId, createdBy: userId, permissions: ["activities.read"] },
    { hashedKey: k4.hashedKey, name: `vitest-act-key-np-${suffix}`, isActive: true, organizationId: orgAId, createdBy: userId, permissions: ["crm.read"] },
    { hashedKey: k5.hashedKey, name: `vitest-act-key-sys-${suffix}`, isActive: true, organizationId: null, createdBy: userId },
  ]).returning({ id: schema.apiKeys.id });
  keyIds = inserted.map(r => r.id);

  await db.insert(schema.accounts).values({ id: ids.acctA, organizationId: orgAId, name: `VT Act Account ${suffix}` });
  await db.insert(schema.leads).values({ id: ids.leadA, organizationId: orgAId, firstName: "Act", lastName: `Lead${suffix}` });

  await db.insert(schema.activities).values([
    {
      id: ids.actCall, organizationId: orgAId, type: "call", subject: `VT call ${suffix}`,
      status: "pending", priority: "high", dueAt: new Date(now + 2 * HOUR),
      relatedType: "Account", relatedId: ids.acctA, notes: "call notes",
    },
    {
      id: ids.actTask, organizationId: orgAId, type: "task", subject: `VT task ${suffix}`,
      status: "completed", priority: "low", dueAt: new Date(now - 2 * HOUR),
      completedAt: new Date(now - HOUR), relatedType: "Lead", relatedId: ids.leadA,
    },
    {
      id: ids.actNote, organizationId: orgAId, type: "note", subject: `VT note ${suffix}`,
      status: "cancelled", priority: "medium",
    },
    {
      id: ids.actB, organizationId: orgBId, type: "call", subject: `VT org-b call ${suffix}`,
      status: "pending", priority: "high",
    },
  ]);
});

afterAll(async () => {
  await db.delete(schema.activities).where(inArray(schema.activities.id, [ids.actCall, ids.actTask, ids.actNote, ids.actB]));
  await db.delete(schema.leads).where(eq(schema.leads.id, ids.leadA));
  await db.delete(schema.accounts).where(eq(schema.accounts.id, ids.acctA));
  if (keyIds.length) await db.delete(schema.apiKeys).where(inArray(schema.apiKeys.id, keyIds));
  await db.delete(schema.organizations).where(inArray(schema.organizations.id, [orgAId, orgBId]));
});

describe("GET /activities — list", () => {
  it("lists activities with the full field shape and pagination envelope, scoped to the key's org", async () => {
    const res = await get("/activities?limit=1000");
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(Array.isArray(body.data)).toBe(true);
    expect(body.pagination).toMatchObject({ limit: 1000, offset: 0 });
    expect(typeof body.pagination.total).toBe("number");
    expect(typeof body.pagination.hasMore).toBe("boolean");

    const act = body.data.find((a: any) => a.id === ids.actCall);
    expect(act).toBeTruthy();
    for (const k of ["id", "type", "subject", "status", "priority", "notes", "dueAt", "completedAt",
      "ownerId", "relatedType", "relatedId", "organizationId", "externalId", "createdAt", "updatedAt"]) {
      expect(act).toHaveProperty(k);
    }
    expect(act.organizationId).toBe(orgAId);
    // Org B's activity must never appear
    expect(body.data.some((a: any) => a.id === ids.actB)).toBe(false);
  });

  it("filters by relatedType", async () => {
    const body = await (await get("/activities?relatedType=Account&limit=1000")).json();
    expect(body.data.some((a: any) => a.id === ids.actCall)).toBe(true);
    expect(body.data.some((a: any) => a.id === ids.actTask)).toBe(false);
    for (const a of body.data) expect(a.relatedType).toBe("Account");
  });

  it("filters by relatedId", async () => {
    const body = await (await get(`/activities?relatedId=${ids.leadA}&limit=1000`)).json();
    expect(body.data.length).toBe(1);
    expect(body.data[0].id).toBe(ids.actTask);
  });

  it("combines relatedType and relatedId", async () => {
    const match = await (await get(`/activities?relatedType=Account&relatedId=${ids.acctA}&limit=1000`)).json();
    expect(match.data.length).toBe(1);
    expect(match.data[0].id).toBe(ids.actCall);

    const mismatch = await (await get(`/activities?relatedType=Lead&relatedId=${ids.acctA}&limit=1000`)).json();
    expect(mismatch.data.length).toBe(0);
  });

  it("filters by type", async () => {
    const body = await (await get("/activities?type=task&limit=1000")).json();
    expect(body.data.some((a: any) => a.id === ids.actTask)).toBe(true);
    for (const a of body.data) expect(a.type).toBe("task");
  });

  it("filters by status", async () => {
    const body = await (await get("/activities?status=cancelled&limit=1000")).json();
    expect(body.data.some((a: any) => a.id === ids.actNote)).toBe(true);
    for (const a of body.data) expect(a.status).toBe("cancelled");
  });

  it("filters by priority", async () => {
    const body = await (await get("/activities?priority=high&limit=1000")).json();
    expect(body.data.some((a: any) => a.id === ids.actCall)).toBe(true);
    for (const a of body.data) expect(a.priority).toBe("high");
  });

  it("filters by dueBefore (dueAt strictly before)", async () => {
    const cutoff = new Date(now).toISOString();
    const body = await (await get(`/activities?dueBefore=${encodeURIComponent(cutoff)}&limit=1000`)).json();
    expect(body.data.some((a: any) => a.id === ids.actTask)).toBe(true);
    expect(body.data.some((a: any) => a.id === ids.actCall)).toBe(false);
    // Activities without a dueAt are excluded by date filters
    expect(body.data.some((a: any) => a.id === ids.actNote)).toBe(false);
  });

  it("filters by dueAfter (dueAt strictly after)", async () => {
    const cutoff = new Date(now).toISOString();
    const body = await (await get(`/activities?dueAfter=${encodeURIComponent(cutoff)}&limit=1000`)).json();
    expect(body.data.some((a: any) => a.id === ids.actCall)).toBe(true);
    expect(body.data.some((a: any) => a.id === ids.actTask)).toBe(false);
  });

  it("filters by updatedSince", async () => {
    const past = new Date(now - HOUR).toISOString();
    const withPast = await (await get(`/activities?updatedSince=${encodeURIComponent(past)}&limit=1000`)).json();
    expect(withPast.data.some((a: any) => a.id === ids.actCall)).toBe(true);

    const future = new Date(now + 24 * HOUR).toISOString();
    const withFuture = await (await get(`/activities?updatedSince=${encodeURIComponent(future)}&limit=1000`)).json();
    expect(withFuture.data.length).toBe(0);
  });

  it("paginates with limit/offset (no overlap, consistent totals)", async () => {
    const all = await (await get("/activities?limit=1000")).json();
    const total = all.pagination.total;
    expect(total).toBe(3); // org A has exactly the 3 seeded activities
    expect(all.pagination.hasMore).toBe(false);

    const page1 = await (await get("/activities?limit=2&offset=0")).json();
    const page2 = await (await get("/activities?limit=2&offset=2")).json();
    expect(page1.data.length).toBe(2);
    expect(page1.pagination).toMatchObject({ total, limit: 2, offset: 0, hasMore: true });
    expect(page2.data.length).toBe(1);
    expect(page2.pagination).toMatchObject({ total, limit: 2, offset: 2, hasMore: false });
    const seen = [...page1.data, ...page2.data].map((a: any) => a.id);
    expect(new Set(seen).size).toBe(3);
  });

  it("returns 400 for an invalid date parameter", async () => {
    for (const q of ["dueBefore=not-a-date", "dueAfter=2024-02-30T00:00:00Z", "updatedSince=2024-01-01"]) {
      const res = await get(`/activities?${q}`);
      expect(res.status, `should reject ${q}`).toBe(400);
      const body = await res.json();
      expect(body.error).toBeTruthy();
      expect(body.message).toBeTruthy();
    }
  });

  it("returns 400 for an invalid enum parameter", async () => {
    for (const q of ["type=fax", "status=done", "priority=urgent", "relatedType=Invoice"]) {
      const res = await get(`/activities?${q}`);
      expect(res.status, `should reject ${q}`).toBe(400);
      const body = await res.json();
      expect(body.message).toBeTruthy();
    }
  });

  it("rejects system (non-org) keys with 403", async () => {
    expect((await get("/activities", sysKey)).status).toBe(403);
    expect((await get(`/activities/${ids.actCall}`, sysKey)).status).toBe(403);
  });
});

describe("GET /activities/:id — detail", () => {
  it("returns the activity in a { data } envelope", async () => {
    const res = await get(`/activities/${ids.actCall}`);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data.id).toBe(ids.actCall);
    expect(body.data.type).toBe("call");
    expect(body.data.subject).toBe(`VT call ${suffix}`);
    expect(body.data.relatedType).toBe("Account");
    expect(body.data.relatedId).toBe(ids.acctA);
    expect(body.data.organizationId).toBe(orgAId);
  });

  it("returns 404 for a nonexistent activity ID", async () => {
    const res = await get(`/activities/ACT-DOES-NOT-EXIST`);
    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body.error).toBe("Not Found");
  });

  it("returns 404 (not 403 or data) for another org's activity — no existence leak", async () => {
    // Org B key requesting org A's activity
    const crossRes = await get(`/activities/${ids.actCall}`, keyB);
    expect(crossRes.status).toBe(404);
    const crossBody = await crossRes.json();
    expect(crossBody.error).toBe("Not Found");
    expect(crossBody.data).toBeUndefined();

    // Response is indistinguishable from a truly missing record
    const missingRes = await get(`/activities/ACT-DOES-NOT-EXIST`, keyB);
    expect(missingRes.status).toBe(404);
    const missingBody = await missingRes.json();
    expect(missingBody.error).toBe(crossBody.error);
  });

  it("org B's list never includes org A activities", async () => {
    const body = await (await get("/activities?limit=1000", keyB)).json();
    expect(body.data.some((a: any) => [ids.actCall, ids.actTask, ids.actNote].includes(a.id))).toBe(false);
    expect(body.data.some((a: any) => a.id === ids.actB)).toBe(true);
  });
});

describe("Permission scopes", () => {
  it("a read-only key with activities.read can access list and detail", async () => {
    const list = await get("/activities?limit=10", readOnlyKey);
    expect(list.status).toBe(200);
    const detail = await get(`/activities/${ids.actCall}`, readOnlyKey);
    expect(detail.status).toBe(200);
    expect((await detail.json()).data.id).toBe(ids.actCall);
  });

  it("a key lacking activities.read receives 403 with requiredPermission", async () => {
    for (const path of ["/activities", `/activities/${ids.actCall}`]) {
      const res = await get(path, noPermKey);
      expect(res.status, `expected 403 for ${path}`).toBe(403);
      const body = await res.json();
      expect(body.requiredPermission).toBe("activities.read");
    }
  });
});
