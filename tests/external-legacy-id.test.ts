import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { db } from "../server/db";
import { generateApiKey } from "../server/api-key-utils";
import * as schema from "@shared/schema";
import { eq, inArray } from "drizzle-orm";

const BASE = "http://localhost:5000/api/v1/external";
const suffix = Date.now();

let orgId: string;
let otherOrgId: string;
let userId: string;
let orgKey: string;
let keyIds: string[] = [];

const canonicalAccount = `ACCT-LEG-${suffix}`;
const legacyAccount = `ACT-LEGACY-${suffix}`;
const canonicalActivity = `ACT-${suffix.toString().slice(-8)}`;
const otherAccount = `ACCT-LEG-O-${suffix}`;
const collisionAccount = `ACCT-LEG-C-${suffix}`;
const otherLegacy = `ACT-OTHER-${suffix}`;

function req(path: string, key: string, init?: { method?: string; body?: any }) {
  return fetch(`${BASE}${path}`, {
    method: init?.method ?? "GET",
    headers: { "x-api-key": key, "Content-Type": "application/json" },
    body: init?.body !== undefined ? JSON.stringify(init.body) : undefined,
  });
}

beforeAll(async () => {
  const users = await db.select().from(schema.users).limit(1);
  userId = users[0].id;
  const [org] = await db.insert(schema.organizations)
    .values({ name: `vitest-legacy-org-${suffix}`, slug: `vitest-legacy-org-${suffix}` }).returning();
  orgId = org.id;
  const [other] = await db.insert(schema.organizations)
    .values({ name: `vitest-legacy-other-${suffix}`, slug: `vitest-legacy-other-${suffix}` }).returning();
  otherOrgId = other.id;

  await db.insert(schema.accounts).values([
    { id: canonicalAccount, name: `legacy-acct-${suffix}`, organizationId: orgId },
    { id: otherAccount, name: `legacy-other-${suffix}`, organizationId: otherOrgId },
    { id: collisionAccount, name: `legacy-collision-${suffix}`, organizationId: orgId },
  ]);
  await db.insert(schema.activities).values({
    id: canonicalActivity, type: "note", subject: "legacy-act", organizationId: orgId, status: "completed",
  });
  await db.insert(schema.legacyIdMap).values([
    { entity: "Account", legacyId: legacyAccount, canonicalId: canonicalAccount },
    { entity: "Account", legacyId: otherLegacy, canonicalId: otherAccount },
    { entity: "Account", legacyId: canonicalActivity, canonicalId: collisionAccount },
  ]);

  const k1 = generateApiKey();
  orgKey = k1.publicKey;
  const inserted = await db.insert(schema.apiKeys).values([
    { hashedKey: k1.hashedKey, name: `vitest-legacy-org-${suffix}`, isActive: true, organizationId: orgId, createdBy: userId },
  ]).returning({ id: schema.apiKeys.id });
  keyIds = inserted.map(r => r.id);
});

afterAll(async () => {
  await db.delete(schema.legacyIdMap).where(inArray(schema.legacyIdMap.canonicalId, [canonicalAccount, otherAccount, collisionAccount]));
  await db.delete(schema.activities).where(eq(schema.activities.id, canonicalActivity));
  await db.delete(schema.accounts).where(inArray(schema.accounts.id, [canonicalAccount, otherAccount, collisionAccount]));
  if (keyIds.length) await db.delete(schema.apiKeys).where(inArray(schema.apiKeys.id, keyIds));
  await db.delete(schema.organizations).where(inArray(schema.organizations.id, [orgId, otherOrgId]));
});

describe("External legacy ID reads", () => {
  it("GET canonical ID returns canonical id + legacyId", async () => {
    const res = await req(`/accounts/${canonicalAccount}`, orgKey);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data.id).toBe(canonicalAccount);
    expect(body.data.legacyId).toBe(legacyAccount);
  });

  it("GET legacy ID returns canonical id + legacyId", async () => {
    const res = await req(`/accounts/${legacyAccount}`, orgKey);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data.id).toBe(canonicalAccount);
    expect(body.data.legacyId).toBe(legacyAccount);
  });

  it("canonical activity PK wins over an Account legacy mapping of the same ACT-* string", async () => {
    const res = await req(`/activities/${canonicalActivity}`, orgKey);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data.id).toBe(canonicalActivity);
    expect(body.data.subject).toBe("legacy-act");
  });

  it("PATCH by legacy ID does not mutate", async () => {
    const before = await req(`/accounts/${canonicalAccount}`, orgKey);
    const originalName = (await before.json()).data.name;
    const res = await req(`/accounts/${legacyAccount}`, orgKey, { method: "PATCH", body: { name: "should-not-stick" } });
    expect(res.status).toBe(404);
    const after = await req(`/accounts/${canonicalAccount}`, orgKey);
    expect((await after.json()).data.name).toBe(originalName);
  });

  it("rejects legacyId in a canonical PATCH body", async () => {
    const res = await req(`/accounts/${canonicalAccount}`, orgKey, { method: "PATCH", body: { legacyId: "x" } });
    expect(res.status).toBe(400);
  });

  it("POST relationship using a legacy accountId does not write", async () => {
    const res = await req("/contacts", orgKey, {
      method: "POST",
      body: { firstName: "No", lastName: "Write", accountId: legacyAccount },
    });
    expect(res.status).toBe(404);
  });

  it("cross-org mapped ID is 404", async () => {
    const res = await req(`/accounts/${otherLegacy}`, orgKey);
    expect(res.status).toBe(404);
  });

  it("list ?legacyId= returns the canonical record", async () => {
    const res = await req(`/accounts?legacyId=${encodeURIComponent(legacyAccount)}`, orgKey);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data.some((a: any) => a.id === canonicalAccount)).toBe(true);
  });
});
