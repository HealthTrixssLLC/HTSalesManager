// Phase G — Comprehensive External API test matrix
// Covers the matrix items not already tested elsewhere:
//   - accounts list/detail field shapes + expand=opportunities / expand=contacts
//   - opportunities list/detail field shapes + expand=account / resources / contacts
//   - contacts list/detail field shapes + expand=account
//   - external activity creation (field shapes, validation, related-record org check)
//   - pagination (limit/offset slicing, totals, hasMore)
//   - cross-tenant isolation matrix (org B key vs org A data, every endpoint family)
//   - rate limiting (429 on exceeding per-key limit)
//   - audit logging (writes appear in GET /logs, scoped to the calling key)
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
let keyA: string; // full access, org A
let keyB: string; // full access, org B
let rlKey: string; // org A, rateLimitPerMin = 3
let keyAId: string;
let keyBId: string;
let keyIds: string[] = [];
let seedUserId: string;
const createdActivityIds: string[] = [];

const ids = {
  acctA1: `ACCT-MX-A1-${suffix}`,
  acctA2: `ACCT-MX-A2-${suffix}`,
  acctA3: `ACCT-MX-A3-${suffix}`,
  acctB1: `ACCT-MX-B1-${suffix}`,
  contA1: `CONT-MX-A1-${suffix}`,
  contA2: `CONT-MX-A2-${suffix}`,
  contB1: `CONT-MX-B1-${suffix}`,
  oppA1: `OPP-MX-A1-${suffix}`,
  oppA2: `OPP-MX-A2-${suffix}`,
  oppA3: `OPP-MX-A3-${suffix}`,
  oppB1: `OPP-MX-B1-${suffix}`,
  leadA1: `LEAD-MX-A1-${suffix}`,
  leadB1: `LEAD-MX-B1-${suffix}`,
};

function get(path: string, key: string) {
  return fetch(`${BASE}${path}`, { headers: { "x-api-key": key } });
}
function send(method: string, path: string, body: any, key: string) {
  return fetch(`${BASE}${path}`, {
    method,
    headers: { "x-api-key": key, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

beforeAll(async () => {
  const users = await db.select().from(schema.users).limit(1);
  expect(users.length).toBeGreaterThan(0);
  seedUserId = users[0].id;

  const [orgA] = await db.insert(schema.organizations)
    .values({ name: `vitest-mx-org-a-${suffix}`, slug: `vitest-mx-org-a-${suffix}` }).returning();
  const [orgB] = await db.insert(schema.organizations)
    .values({ name: `vitest-mx-org-b-${suffix}`, slug: `vitest-mx-org-b-${suffix}` }).returning();
  orgAId = orgA.id;
  orgBId = orgB.id;

  const k1 = generateApiKey();
  const k2 = generateApiKey();
  const k3 = generateApiKey();
  keyA = k1.publicKey;
  keyB = k2.publicKey;
  rlKey = k3.publicKey;
  const inserted = await db.insert(schema.apiKeys).values([
    { hashedKey: k1.hashedKey, name: `vitest-mx-key-a-${suffix}`, isActive: true, organizationId: orgAId, createdBy: seedUserId },
    { hashedKey: k2.hashedKey, name: `vitest-mx-key-b-${suffix}`, isActive: true, organizationId: orgBId, createdBy: seedUserId },
    { hashedKey: k3.hashedKey, name: `vitest-mx-key-rl-${suffix}`, isActive: true, organizationId: orgAId, createdBy: seedUserId, rateLimitPerMin: 3 },
  ]).returning({ id: schema.apiKeys.id });
  keyIds = inserted.map(r => r.id);
  keyAId = inserted[0].id;
  keyBId = inserted[1].id;

  // Org A data
  await db.insert(schema.accounts).values([
    { id: ids.acctA1, organizationId: orgAId, name: "MX Account A1", industry: "Software", type: "customer" },
    { id: ids.acctA2, organizationId: orgAId, name: "MX Account A2" },
    { id: ids.acctA3, organizationId: orgAId, name: "MX Account A3" },
  ]);
  await db.insert(schema.contacts).values([
    { id: ids.contA1, organizationId: orgAId, accountId: ids.acctA1, firstName: "Mia", lastName: "Matrix", email: `mia-mx-${suffix}@example.com`, title: "CTO" },
    { id: ids.contA2, organizationId: orgAId, firstName: "Max", lastName: "Matrix" },
  ]);
  await db.insert(schema.opportunities).values([
    { id: ids.oppA1, organizationId: orgAId, accountId: ids.acctA1, name: "MX Opp A1", closeDate: new Date(), stage: "prospecting", amount: "1000" },
    { id: ids.oppA2, organizationId: orgAId, accountId: ids.acctA1, name: "MX Opp A2", closeDate: new Date() },
    { id: ids.oppA3, organizationId: orgAId, accountId: ids.acctA2, name: "MX Opp A3", closeDate: new Date() },
  ]);
  await db.insert(schema.leads).values({
    id: ids.leadA1, organizationId: orgAId, firstName: "Lena", lastName: "MatrixA",
  });
  // Resource assignment + contact link for expand tests
  await db.insert(schema.opportunityResources).values({
    opportunityId: ids.oppA1, userId: seedUserId, role: "Engineer", allocation: 50,
  });
  await db.insert(schema.opportunityContacts).values({
    opportunityId: ids.oppA1, contactId: ids.contA1, role: "champion", isPrimary: true,
  });

  // Org B data
  await db.insert(schema.accounts).values({ id: ids.acctB1, organizationId: orgBId, name: "MX Account B1" });
  await db.insert(schema.contacts).values({ id: ids.contB1, organizationId: orgBId, firstName: "Bea", lastName: "MatrixB" });
  await db.insert(schema.opportunities).values({ id: ids.oppB1, organizationId: orgBId, accountId: ids.acctB1, name: "MX Opp B1", closeDate: new Date() });
  await db.insert(schema.leads).values({ id: ids.leadB1, organizationId: orgBId, firstName: "Bob", lastName: "MatrixB" });
});

afterAll(async () => {
  if (createdActivityIds.length > 0) {
    await db.delete(schema.activityAssociations).where(inArray(schema.activityAssociations.activityId, createdActivityIds));
    await db.delete(schema.activities).where(inArray(schema.activities.id, createdActivityIds));
  }
  await db.delete(schema.opportunityContacts).where(eq(schema.opportunityContacts.opportunityId, ids.oppA1));
  await db.delete(schema.opportunityResources).where(eq(schema.opportunityResources.opportunityId, ids.oppA1));
  await db.delete(schema.opportunities).where(inArray(schema.opportunities.id, [ids.oppA1, ids.oppA2, ids.oppA3, ids.oppB1]));
  await db.delete(schema.leads).where(inArray(schema.leads.id, [ids.leadA1, ids.leadB1]));
  await db.delete(schema.contacts).where(inArray(schema.contacts.id, [ids.contA1, ids.contA2, ids.contB1]));
  await db.delete(schema.accounts).where(inArray(schema.accounts.id, [ids.acctA1, ids.acctA2, ids.acctA3, ids.acctB1]));
  if (keyIds.length > 0) await db.delete(schema.apiKeys).where(inArray(schema.apiKeys.id, keyIds));
  await db.delete(schema.organizations).where(inArray(schema.organizations.id, [orgAId, orgBId]));
});

// ── Accounts ────────────────────────────────────────────────────────────────

describe("External accounts list/detail", () => {
  it("lists accounts with the lean field shape, scoped to the key's org", async () => {
    const res = await get("/accounts?limit=1000", keyA);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.pagination).toMatchObject({ limit: 1000, offset: 0 });
    const acct = body.data.find((a: any) => a.id === ids.acctA1);
    expect(acct).toBeTruthy();
    for (const k of ["id", "name", "accountNumber", "type", "category", "ownerId", "industry", "externalId", "createdAt", "updatedAt"]) {
      expect(acct).toHaveProperty(k);
    }
    expect(acct).not.toHaveProperty("opportunities");
    expect(body.data.some((a: any) => a.id === ids.acctB1)).toBe(false);
  });

  it("expands opportunities on the list endpoint", async () => {
    const res = await get("/accounts?limit=1000&expand=opportunities", keyA);
    const body = await res.json();
    const acct = body.data.find((a: any) => a.id === ids.acctA1);
    expect(Array.isArray(acct.opportunities)).toBe(true);
    const opp = acct.opportunities.find((o: any) => o.id === ids.oppA1);
    expect(opp).toBeTruthy();
    for (const k of ["id", "name", "stage", "amount", "closeDate", "probability", "implementationStartDate", "implementationEndDate", "billingEndDate"]) {
      expect(opp).toHaveProperty(k);
    }
  });

  it("returns account detail with expand=opportunities,contacts", async () => {
    const res = await get(`/accounts/${ids.acctA1}?expand=opportunities,contacts`, keyA);
    expect(res.status).toBe(200);
    const { data } = await res.json();
    expect(data.id).toBe(ids.acctA1);
    expect(data.name).toBe("MX Account A1");
    for (const k of ["website", "phone", "industry", "createdAt", "updatedAt"]) {
      expect(data).toHaveProperty(k);
    }
    expect(data.opportunities.map((o: any) => o.id)).toContain(ids.oppA1);
    const contact = data.contacts.find((c: any) => c.id === ids.contA1);
    expect(contact).toMatchObject({ firstName: "Mia", lastName: "Matrix", title: "CTO" });
  });

  it("returns 404 for an unknown account id", async () => {
    const res = await get(`/accounts/ACCT-DOES-NOT-EXIST`, keyA);
    expect(res.status).toBe(404);
  });
});

// ── Opportunities ───────────────────────────────────────────────────────────

describe("External opportunities list/detail", () => {
  it("lists opportunities with the lean field shape, scoped to the key's org", async () => {
    const res = await get("/opportunities?limit=1000&includeInForecast=all", keyA);
    expect(res.status).toBe(200);
    const body = await res.json();
    const opp = body.data.find((o: any) => o.id === ids.oppA1);
    expect(opp).toBeTruthy();
    for (const k of ["id", "accountId", "name", "stage", "amount", "closeDate", "ownerId", "probability", "status",
      "actualCloseDate", "actualRevenue", "estCloseDate", "estRevenue", "rating", "includeInForecast",
      "implementationStartDate", "implementationEndDate", "billingEndDate", "externalId", "createdAt", "updatedAt"]) {
      expect(opp).toHaveProperty(k);
    }
    expect(body.data.some((o: any) => o.id === ids.oppB1)).toBe(false);
  });

  it("expands account and resources on the list endpoint", async () => {
    const res = await get("/opportunities?limit=1000&includeInForecast=all&expand=account,resources", keyA);
    const body = await res.json();
    const opp = body.data.find((o: any) => o.id === ids.oppA1);
    expect(opp.account).toMatchObject({ id: ids.acctA1, name: "MX Account A1" });
    expect(Array.isArray(opp.resources)).toBe(true);
    expect(opp.resources[0]).toMatchObject({ userId: seedUserId, role: "Engineer", allocationPercentage: 50 });
  });

  it("returns opportunity detail with expand=account,resources,contacts", async () => {
    const res = await get(`/opportunities/${ids.oppA1}?expand=account,resources,contacts`, keyA);
    expect(res.status).toBe(200);
    const { data } = await res.json();
    expect(data.id).toBe(ids.oppA1);
    expect(data.account.id).toBe(ids.acctA1);
    expect(data.resources.length).toBeGreaterThan(0);
    const contact = data.contacts.find((c: any) => c.contactId === ids.contA1);
    expect(contact).toMatchObject({ role: "champion", isPrimary: true, firstName: "Mia" });
  });

  it("filters by includeInForecast", async () => {
    // All seeded opps default to includeInForecast=true → visible under default filter
    const res = await get("/opportunities?limit=1000", keyA);
    const body = await res.json();
    expect(body.data.some((o: any) => o.id === ids.oppA1)).toBe(true);
    // includeInForecast=false excludes them
    const resFalse = await get("/opportunities?limit=1000&includeInForecast=false", keyA);
    const bodyFalse = await resFalse.json();
    expect(bodyFalse.data.some((o: any) => o.id === ids.oppA1)).toBe(false);
  });
});

// ── Contacts ────────────────────────────────────────────────────────────────

describe("External contacts list/detail", () => {
  it("lists contacts with the guaranteed field shape, scoped to the key's org", async () => {
    const res = await get("/contacts?limit=1000", keyA);
    expect(res.status).toBe(200);
    const body = await res.json();
    const contact = body.data.find((c: any) => c.id === ids.contA1);
    expect(contact).toBeTruthy();
    for (const k of ["id", "firstName", "lastName", "title", "email", "phone", "mobile", "accountId", "ownerId", "externalId", "createdAt", "updatedAt"]) {
      expect(contact).toHaveProperty(k);
    }
    expect(body.data.some((c: any) => c.id === ids.contB1)).toBe(false);
  });

  it("expands account on list and detail", async () => {
    const resList = await get("/contacts?limit=1000&expand=account", keyA);
    const bodyList = await resList.json();
    const listContact = bodyList.data.find((c: any) => c.id === ids.contA1);
    expect(listContact.account).toMatchObject({ id: ids.acctA1, name: "MX Account A1" });

    const resDetail = await get(`/contacts/${ids.contA1}?expand=account`, keyA);
    expect(resDetail.status).toBe(200);
    const { data } = await resDetail.json();
    expect(data.account).toMatchObject({ id: ids.acctA1, name: "MX Account A1" });

    // Contact without an account → account: null
    const resNoAcct = await get(`/contacts/${ids.contA2}?expand=account`, keyA);
    const bodyNoAcct = await resNoAcct.json();
    expect(bodyNoAcct.data.account).toBeNull();
  });

  it("returns 404 for an unknown contact id", async () => {
    const res = await get(`/contacts/CONT-DOES-NOT-EXIST`, keyA);
    expect(res.status).toBe(404);
  });
});

// ── Activities (external creation) ─────────────────────────────────────────

describe("External activity creation", () => {
  it("creates an activity with the full response field shape", async () => {
    const res = await send("POST", "/activities", {
      type: "task",
      subject: `MX Activity ${suffix}`,
      status: "pending",
      priority: "high",
      notes: "matrix test",
      relatedType: "Account",
      relatedId: ids.acctA1,
    }, keyA);
    expect(res.status).toBe(201);
    const { data } = await res.json();
    createdActivityIds.push(data.id);
    for (const k of ["id", "type", "subject", "status", "priority", "notes", "dueAt", "completedAt",
      "relatedType", "relatedId", "organizationId", "createdAt", "updatedAt"]) {
      expect(data).toHaveProperty(k);
    }
    expect(data.organizationId).toBe(orgAId);
    expect(data.relatedId).toBe(ids.acctA1);
  });

  it("rejects invalid payloads with field-level errors", async () => {
    const res = await send("POST", "/activities", { type: "bogus", subject: "" }, keyA);
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toBe("Validation failed");
  });

  it("rejects unknown fields (strict schema)", async () => {
    const res = await send("POST", "/activities", { type: "task", subject: "x", organizationId: "hacked" }, keyA);
    expect(res.status).toBe(400);
  });

  it("rejects relatedType without relatedId", async () => {
    const res = await send("POST", "/activities", { type: "task", subject: "x", relatedType: "Account" }, keyA);
    expect(res.status).toBe(400);
  });

  it("returns 404 for a related record in another org (no info leak)", async () => {
    const res = await send("POST", "/activities", {
      type: "task", subject: "cross-org", relatedType: "Account", relatedId: ids.acctB1,
    }, keyA);
    expect(res.status).toBe(404);
  });
});

// ── Pagination ──────────────────────────────────────────────────────────────

describe("External API pagination", () => {
  it("slices accounts correctly with limit/offset and consistent totals", async () => {
    const all = await (await get("/accounts?limit=1000", keyA)).json();
    const total = all.pagination.total;
    expect(total).toBe(3); // org A has exactly the 3 seeded accounts
    expect(all.pagination.hasMore).toBe(false);

    const page1 = await (await get("/accounts?limit=2&offset=0", keyA)).json();
    const page2 = await (await get("/accounts?limit=2&offset=2", keyA)).json();
    expect(page1.data.length).toBe(2);
    expect(page1.pagination).toMatchObject({ total, limit: 2, offset: 0, hasMore: true });
    expect(page2.data.length).toBe(1);
    expect(page2.pagination).toMatchObject({ total, limit: 2, offset: 2, hasMore: false });

    // No overlap and full coverage
    const idsSeen = [...page1.data, ...page2.data].map((a: any) => a.id);
    expect(new Set(idsSeen).size).toBe(3);
  });

  it("slices opportunities correctly with limit/offset", async () => {
    const page = await (await get("/opportunities?limit=2&offset=1&includeInForecast=all", keyA)).json();
    expect(page.pagination.total).toBe(3);
    expect(page.data.length).toBe(2);
    expect(page.pagination.hasMore).toBe(false);
  });
});

// ── Cross-tenant isolation matrix ───────────────────────────────────────────

describe("Cross-tenant isolation (org B key vs org A data)", () => {
  it("cannot read org A records via detail endpoints (404)", async () => {
    for (const path of [
      `/accounts/${ids.acctA1}`,
      `/opportunities/${ids.oppA1}`,
      `/contacts/${ids.contA1}`,
      `/leads/${ids.leadA1}`,
    ]) {
      const res = await get(path, keyB);
      expect(res.status, `expected 404 for ${path}`).toBe(404);
    }
  });

  it("list endpoints never include org A records", async () => {
    const [accounts, opps, contacts, leads] = await Promise.all([
      get("/accounts?limit=1000", keyB).then(r => r.json()),
      get("/opportunities?limit=1000&includeInForecast=all", keyB).then(r => r.json()),
      get("/contacts?limit=1000", keyB).then(r => r.json()),
      get("/leads?limit=1000", keyB).then(r => r.json()),
    ]);
    expect(accounts.data.some((a: any) => a.id.includes(`-A1-${suffix}`) || a.id === ids.acctA1)).toBe(false);
    expect(opps.data.some((o: any) => [ids.oppA1, ids.oppA2, ids.oppA3].includes(o.id))).toBe(false);
    expect(contacts.data.some((c: any) => [ids.contA1, ids.contA2].includes(c.id))).toBe(false);
    expect(leads.data.some((l: any) => l.id === ids.leadA1)).toBe(false);
  });

  it("cannot mutate org A records via PATCH (404)", async () => {
    for (const path of [
      `/accounts/${ids.acctA1}`,
      `/contacts/${ids.contA1}`,
      `/leads/${ids.leadA1}`,
      `/opportunities/${ids.oppA1}`,
    ]) {
      const res = await send("PATCH", path, { externalId: "hacked" }, keyB);
      expect(res.status, `expected 404 for PATCH ${path}`).toBe(404);
    }
  });

  it("cannot link/unlink contacts on an org A opportunity (404)", async () => {
    const link = await send("POST", `/opportunities/${ids.oppA1}/contacts`, { contactId: ids.contB1, role: "champion" }, keyB);
    expect(link.status).toBe(404);
    const unlink = await fetch(`${BASE}/opportunities/${ids.oppA1}/contacts/${ids.contA1}`, {
      method: "DELETE", headers: { "x-api-key": keyB },
    });
    expect(unlink.status).toBe(404);
  });

  it("cannot attach an activity to an org A record (404)", async () => {
    const res = await send("POST", "/activities", {
      type: "task", subject: "cross-tenant", relatedType: "Opportunity", relatedId: ids.oppA1,
    }, keyB);
    expect(res.status).toBe(404);
  });
});

// ── Rate limiting ───────────────────────────────────────────────────────────

describe("External API rate limiting", () => {
  it("returns 429 once the per-key limit is exceeded", async () => {
    const statuses: number[] = [];
    for (let i = 0; i < 6; i++) {
      const res = await get("/accounts?limit=1", rlKey);
      statuses.push(res.status);
    }
    expect(statuses.filter(s => s === 200).length).toBeGreaterThan(0);
    expect(statuses).toContain(429);
    // The 429 body carries the standard error message
    const res = await get("/accounts?limit=1", rlKey);
    expect(res.status).toBe(429);
    const body = await res.json();
    expect(body.error).toBe("Too many requests");
  });
});

// ── Audit logging via GET /logs ─────────────────────────────────────────────

describe("External API audit logging (GET /logs)", () => {
  it("records write operations and scopes logs to the calling key", async () => {
    const email = `mx-audit-${suffix}@example.com`;
    const createRes = await send("POST", "/leads", { firstName: "Audit", lastName: "Matrix", email }, keyA);
    expect(createRes.status).toBe(201);
    const created = await createRes.json();

    // Audit writes are fire-and-forget — allow them to settle
    await new Promise(r => setTimeout(r, 1500));

    const logsRes = await get("/logs?limit=1000", keyA);
    expect(logsRes.status).toBe(200);
    const logs = await logsRes.json();
    const entries = logs.data ?? logs.logs ?? [];
    const writeEntry = entries.find((l: any) => {
      const after = l.after ?? l;
      return (after.method ?? l.method) === "POST" && String(after.endpoint ?? l.endpoint ?? "").includes("/leads");
    });
    expect(writeEntry, "POST /leads should appear in the key's audit logs").toBeTruthy();

    // Org B's key must not see org A key's log entries (per-key scoping)
    const logsB = await (await get("/logs?limit=1000", keyB)).json();
    const entriesB = logsB.data ?? logsB.logs ?? [];
    const leaked = entriesB.find((l: any) => {
      const after = l.after ?? l;
      return (after.apiKeyName ?? "").includes(`vitest-mx-key-a-${suffix}`);
    });
    expect(leaked).toBeFalsy();

    // cleanup created lead
    await db.delete(schema.leads).where(eq(schema.leads.id, created.data.id));
  });
});
