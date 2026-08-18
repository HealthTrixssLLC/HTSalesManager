// Integration tests — Activity idempotency (externalId) + machine-readable error codes
// Requires the dev server to be running on localhost:5000
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { db } from "../server/db";
import { generateApiKey } from "../server/api-key-utils";
import * as schema from "@shared/schema";
import { eq, inArray, like } from "drizzle-orm";

const BASE = "http://localhost:5000/api/v1/external";
const suffix = Date.now();

let orgId: string;
let userId: string;
let key: string;          // org key, full permissions
let roKey: string;        // org key, activities.read only (no write)
let limitedKey: string;   // org key with rateLimitPerMin=2 for the 429 test
let keyIds: string[] = [];
let createdActivityIds: string[] = [];

const acctId = `ACCT-VTIDEM-${suffix}`;

function req(path: string, k: string, init?: { method?: string; body?: any; headers?: Record<string, string> }) {
  return fetch(`${BASE}${path}`, {
    method: init?.method ?? "GET",
    headers: { "x-api-key": k, "content-type": "application/json", ...(init?.headers ?? {}) },
    body: init?.body !== undefined ? JSON.stringify(init.body) : undefined,
  });
}
const post = (p: string, body: any, k = key) => req(p, k, { method: "POST", body });

beforeAll(async () => {
  const users = await db.select().from(schema.users).limit(1);
  userId = users[0].id;
  const [org] = await db.insert(schema.organizations)
    .values({ name: `vitest-idem-org-${suffix}`, slug: `vitest-idem-org-${suffix}` }).returning();
  orgId = org.id;

  const k1 = generateApiKey();
  const k2 = generateApiKey();
  const k3 = generateApiKey();
  key = k1.publicKey;
  roKey = k2.publicKey;
  limitedKey = k3.publicKey;
  const inserted = await db.insert(schema.apiKeys).values([
    { hashedKey: k1.hashedKey, name: `vitest-idem-key-${suffix}`, isActive: true, organizationId: orgId, createdBy: userId },
    { hashedKey: k2.hashedKey, name: `vitest-idem-key-ro-${suffix}`, isActive: true, organizationId: orgId, createdBy: userId, permissions: ["activities.read"] },
    { hashedKey: k3.hashedKey, name: `vitest-idem-key-rl-${suffix}`, isActive: true, organizationId: orgId, createdBy: userId, rateLimitPerMin: 2 },
  ]).returning({ id: schema.apiKeys.id });
  keyIds = inserted.map(r => r.id);

  await db.insert(schema.accounts).values({ id: acctId, organizationId: orgId, name: `VT Idem Account ${suffix}` });
});

afterAll(async () => {
  if (createdActivityIds.length) {
    await db.delete(schema.activities).where(inArray(schema.activities.id, createdActivityIds));
  }
  await db.delete(schema.activities).where(eq(schema.activities.organizationId, orgId));
  await db.delete(schema.tags).where(like(schema.tags.name, `vtidem-%-${suffix}`));
  await db.delete(schema.accounts).where(eq(schema.accounts.id, acctId));
  if (keyIds.length) await db.delete(schema.apiKeys).where(inArray(schema.apiKeys.id, keyIds));
  await db.delete(schema.organizations).where(eq(schema.organizations.id, orgId));
});

// ========== ACTIVITY IDEMPOTENCY (externalId) ==========

describe("POST /activities — externalId idempotency", () => {
  const extId = `vtidem-token-${suffix}`;
  const payload = { type: "call", subject: `VT idem call ${suffix}`, externalId: extId };
  let firstId: string;

  it("creates an activity with an externalId (201) and echoes it back", async () => {
    const res = await post("/activities", payload);
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.data.externalId).toBe(extId);
    firstId = body.data.id;
    createdActivityIds.push(firstId);
  });

  it("identical replay returns 200 with the SAME activity, creating no duplicate", async () => {
    const res = await post("/activities", payload);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data.id).toBe(firstId);
    expect(body.data.externalId).toBe(extId);

    const rows = await db.select().from(schema.activities)
      .where(eq(schema.activities.externalId, extId));
    expect(rows.filter(r => r.organizationId === orgId).length).toBe(1);
  });

  it("replay with a different type/subject returns 409 IDEMPOTENCY_CONFLICT and creates nothing", async () => {
    const res = await post("/activities", { ...payload, subject: "totally different subject" });
    expect(res.status).toBe(409);
    const body = await res.json();
    expect(body.code).toBe("IDEMPOTENCY_CONFLICT");
    expect(body.error).toBeTruthy();
    expect(body.existingActivityId).toBe(firstId);

    const rows = await db.select().from(schema.activities)
      .where(eq(schema.activities.externalId, extId));
    expect(rows.filter(r => r.organizationId === orgId).length).toBe(1);
  });

  it("omitting externalId behaves exactly as before (two creates → two activities)", async () => {
    const body = { type: "note", subject: `VT idem no-token ${suffix}` };
    const r1 = await post("/activities", body);
    const r2 = await post("/activities", body);
    expect(r1.status).toBe(201);
    expect(r2.status).toBe(201);
    const a1 = (await r1.json()).data;
    const a2 = (await r2.json()).data;
    expect(a1.id).not.toBe(a2.id);
    expect(a1.externalId).toBeNull();
    createdActivityIds.push(a1.id, a2.id);
  });

  it("rejects an externalId over 100 chars (400 VALIDATION_ERROR)", async () => {
    const res = await post("/activities", { type: "call", subject: "x", externalId: "y".repeat(101) });
    expect(res.status).toBe(400);
    expect((await res.json()).code).toBe("VALIDATION_ERROR");
  });

  it("concurrent identical requests create exactly one activity (atomic claim)", async () => {
    const token = `vtidem-race-${suffix}`;
    const body = { type: "task", subject: `VT idem race ${suffix}`, externalId: token };
    const responses = await Promise.all(Array.from({ length: 6 }, () => post("/activities", body)));
    const statuses = responses.map(r => r.status).sort();
    // Exactly one 201 (the winner); everyone else replays with 200
    expect(statuses.filter(s => s === 201).length).toBe(1);
    expect(statuses.filter(s => s === 200).length).toBe(5);
    const bodies = await Promise.all(responses.map(r => r.json()));
    const uniqueIds = new Set(bodies.map(b => b.data.id));
    expect(uniqueIds.size).toBe(1);

    const rows = await db.select().from(schema.activities)
      .where(eq(schema.activities.externalId, token));
    expect(rows.filter(r => r.organizationId === orgId).length).toBe(1);
    createdActivityIds.push([...uniqueIds][0] as string);
  });

  it("concurrent conflicting requests: one wins, mismatched payloads get 409, still one row", async () => {
    const token = `vtidem-race2-${suffix}`;
    const mk = (subject: string) => ({ type: "call", subject, externalId: token });
    const responses = await Promise.all([
      post("/activities", mk("subject A")), post("/activities", mk("subject A")),
      post("/activities", mk("subject B")), post("/activities", mk("subject B")),
    ]);
    const statuses = responses.map(r => r.status);
    expect(statuses.filter(s => s === 201).length).toBe(1);
    // Every non-winner is either an identical replay (200) or a conflict (409)
    for (const s of statuses) expect([200, 201, 409]).toContain(s);
    const rows = await db.select().from(schema.activities)
      .where(eq(schema.activities.externalId, token));
    expect(rows.filter(r => r.organizationId === orgId).length).toBe(1);
    createdActivityIds.push(rows[0].id);
  });

  it("the same externalId is independent across orgs (no cross-org dedupe)", async () => {
    // Same token used in another org must not collide: create a second org+key
    const [otherOrg] = await db.insert(schema.organizations)
      .values({ name: `vitest-idem-org2-${suffix}`, slug: `vitest-idem-org2-${suffix}` }).returning();
    const k = generateApiKey();
    const [row] = await db.insert(schema.apiKeys).values({
      hashedKey: k.hashedKey, name: `vitest-idem-key2-${suffix}`, isActive: true,
      organizationId: otherOrg.id, createdBy: userId,
    }).returning({ id: schema.apiKeys.id });
    try {
      const res = await post("/activities", { type: "email", subject: "other org", externalId: extId }, k.publicKey);
      expect(res.status).toBe(201);
      const created = (await res.json()).data;
      expect(created.id).not.toBe(firstId);
      await db.delete(schema.activities).where(eq(schema.activities.id, created.id));
    } finally {
      await db.delete(schema.apiKeys).where(eq(schema.apiKeys.id, row.id));
      await db.delete(schema.organizations).where(eq(schema.organizations.id, otherOrg.id));
    }
  });
});

// ========== MACHINE-READABLE ERROR CODES ==========

describe("Error responses carry machine-readable code fields", () => {
  it("400 validation error → VALIDATION_ERROR (activity create)", async () => {
    const res = await post("/activities", { type: "fax", subject: "" });
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.code).toBe("VALIDATION_ERROR");
    expect(body.error).toBeTruthy(); // legacy string fields preserved
  });

  it("403 scope error → INSUFFICIENT_SCOPE (missing permission)", async () => {
    const res = await post("/activities", { type: "call", subject: "nope" }, roKey);
    expect(res.status).toBe(403);
    const body = await res.json();
    expect(body.code).toBe("INSUFFICIENT_SCOPE");
    expect(body.requiredPermission).toBe("activities.write"); // legacy field preserved
  });

  it("404 missing related record → NOT_FOUND (activity create)", async () => {
    const res = await post("/activities", {
      type: "call", subject: "x", relatedType: "Account", relatedId: "ACCT-DOES-NOT-EXIST",
    });
    expect(res.status).toBe(404);
    expect((await res.json()).code).toBe("NOT_FOUND");
  });

  it("404 missing record → NOT_FOUND (PATCH)", async () => {
    const res = await req("/accounts/ACCT-DOES-NOT-EXIST", key, { method: "PATCH", body: { industry: "x" } });
    expect(res.status).toBe(404);
    expect((await res.json()).code).toBe("NOT_FOUND");
  });

  it("400 unknown/immutable/empty PATCH bodies → VALIDATION_ERROR", async () => {
    const cases: Array<[any, string]> = [
      [{ bogusField: 1 }, "unknown field"],
      [{ id: "ACCT-NEW" }, "immutable field"],
      [{}, "empty update"],
    ];
    for (const [body, label] of cases) {
      const res = await req(`/accounts/${acctId}`, key, { method: "PATCH", body });
      expect(res.status, label).toBe(400);
      expect((await res.json()).code, label).toBe("VALIDATION_ERROR");
    }
  });

  it("409 duplicate tag → TAG_ALREADY_EXISTS with existingTagId retained", async () => {
    const name = `vtidem-tag-${suffix}`;
    const created = await post("/tags", { name });
    expect(created.status).toBe(201);
    const dup = await post("/tags", { name: name.toUpperCase() });
    expect(dup.status).toBe(409);
    const body = await dup.json();
    expect(body.code).toBe("TAG_ALREADY_EXISTS");
    expect(body.existingTagId).toBe((await created.json()).data.id);
    expect(body.error).toBe("Tag already exists");
  });

  it("404 unknown tag name on assignment → NOT_FOUND", async () => {
    const res = await post(`/accounts/${acctId}/tags`, { name: `vtidem-ghost-${suffix}` });
    expect(res.status).toBe(404);
    expect((await res.json()).code).toBe("NOT_FOUND");
  });

  it("412 stale If-Match → STALE_RECORD (PATCH)", async () => {
    const res = await req(`/accounts/${acctId}`, key, {
      method: "PATCH",
      body: { industry: "stale-check" },
      headers: { "if-match": `"${Buffer.from("2000-01-01T00:00:00.000Z").toString("base64url")}"` },
    });
    expect(res.status).toBe(412);
    expect((await res.json()).code).toBe("STALE_RECORD");
  });

  it("429 rate limit → RATE_LIMITED (per-key limiter)", async () => {
    let last: Response | null = null;
    for (let i = 0; i < 5; i++) {
      last = await req("/tags?limit=1", limitedKey);
      if (last.status === 429) break;
    }
    expect(last!.status).toBe(429);
    expect((await last!.json()).code).toBe("RATE_LIMITED");
  });
});
