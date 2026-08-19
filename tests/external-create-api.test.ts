import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { db } from "../server/db";
import { generateApiKey } from "../server/api-key-utils";
import * as schema from "@shared/schema";
import { eq, inArray, like } from "drizzle-orm";

const BASE = "http://localhost:5000/api/v1/external";
const suffix = Date.now();

let orgId: string;
let otherOrgId: string;
let userId: string;
let orgKey: string;
let sysKey: string;
let readKey: string;
let keyIds: string[] = [];
let createdIds = { accounts: [] as string[], contacts: [] as string[], opportunities: [] as string[] };

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
    .values({ name: `vitest-create-org-${suffix}`, slug: `vitest-create-org-${suffix}` }).returning();
  orgId = org.id;
  const [other] = await db.insert(schema.organizations)
    .values({ name: `vitest-create-other-${suffix}`, slug: `vitest-create-other-${suffix}` }).returning();
  otherOrgId = other.id;
  const k1 = generateApiKey();
  const k2 = generateApiKey();
  const k3 = generateApiKey();
  orgKey = k1.publicKey;
  sysKey = k2.publicKey;
  readKey = k3.publicKey;
  const inserted = await db.insert(schema.apiKeys).values([
    { hashedKey: k1.hashedKey, name: `vitest-create-org-${suffix}`, isActive: true, organizationId: orgId, createdBy: userId },
    { hashedKey: k2.hashedKey, name: `vitest-create-sys-${suffix}`, isActive: true, organizationId: null, createdBy: userId },
    { hashedKey: k3.hashedKey, name: `vitest-create-ro-${suffix}`, isActive: true, organizationId: orgId, createdBy: userId, permissions: ["crm.read"] },
  ]).returning({ id: schema.apiKeys.id });
  keyIds = inserted.map(r => r.id);
});

afterAll(async () => {
  if (createdIds.opportunities.length) await db.delete(schema.opportunities).where(inArray(schema.opportunities.id, createdIds.opportunities));
  if (createdIds.contacts.length) await db.delete(schema.contacts).where(inArray(schema.contacts.id, createdIds.contacts));
  if (createdIds.accounts.length) await db.delete(schema.accounts).where(inArray(schema.accounts.id, createdIds.accounts));
  await db.delete(schema.accounts).where(like(schema.accounts.name, `vitest-create-%${suffix}%`));
  if (keyIds.length) await db.delete(schema.apiKeys).where(inArray(schema.apiKeys.id, keyIds));
  await db.delete(schema.organizations).where(inArray(schema.organizations.id, [orgId, otherOrgId]));
});

describe("External create API", () => {
  it("creates an account with an org-bound key", async () => {
    const res = await req("/accounts", orgKey, { method: "POST", body: { name: `vitest-create-acct-${suffix}` } });
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.duplicate).toBe(false);
    expect(body.data.id).toMatch(/^ACCT-/);
    expect(body.data.name).toBe(`vitest-create-acct-${suffix}`);
    expect(body.data.legacyId).toBeNull();
    createdIds.accounts.push(body.data.id);
  });

  it("rejects system key on create", async () => {
    const res = await req("/accounts", sysKey, { method: "POST", body: { name: "nope" } });
    expect(res.status).toBe(403);
    const body = await res.json();
    expect(body.code).toBe("INSUFFICIENT_SCOPE");
  });

  it("rejects missing crm.write", async () => {
    const res = await req("/accounts", readKey, { method: "POST", body: { name: "nope" } });
    expect(res.status).toBe(403);
  });

  it("rejects unknown fields", async () => {
    const res = await req("/accounts", orgKey, { method: "POST", body: { name: "x", bogus: true } });
    expect(res.status).toBe(400);
  });

  it("replays the same externalId with the same name", async () => {
    const token = `create-acct-${suffix}`;
    const first = await req("/accounts", orgKey, { method: "POST", body: { name: `vitest-create-idem-${suffix}`, externalId: token } });
    expect(first.status).toBe(201);
    const created = (await first.json()).data;
    createdIds.accounts.push(created.id);
    const second = await req("/accounts", orgKey, { method: "POST", body: { name: `vitest-create-idem-${suffix}`, externalId: token } });
    expect(second.status).toBe(200);
    const replay = await second.json();
    expect(replay.duplicate).toBe(true);
    expect(replay.data.id).toBe(created.id);
  });

  it("conflicts when externalId is reused with a different name", async () => {
    const token = `create-acct-conflict-${suffix}`;
    const first = await req("/accounts", orgKey, { method: "POST", body: { name: `vitest-create-conf-a-${suffix}`, externalId: token } });
    expect(first.status).toBe(201);
    createdIds.accounts.push((await first.json()).data.id);
    const second = await req("/accounts", orgKey, { method: "POST", body: { name: `vitest-create-conf-b-${suffix}`, externalId: token } });
    expect(second.status).toBe(409);
    expect((await second.json()).code).toBe("IDEMPOTENCY_CONFLICT");
  });

  it("creates a contact and opportunity against a canonical account", async () => {
    const acctRes = await req("/accounts", orgKey, { method: "POST", body: { name: `vitest-create-parent-${suffix}` } });
    const accountId = (await acctRes.json()).data.id;
    createdIds.accounts.push(accountId);

    const contactRes = await req("/contacts", orgKey, {
      method: "POST",
      body: { firstName: "Vitest", lastName: "Contact", accountId },
    });
    expect(contactRes.status).toBe(201);
    const contact = (await contactRes.json()).data;
    expect(contact.id).toMatch(/^CONT-/);
    createdIds.contacts.push(contact.id);

    const closeDate = new Date(Date.now() + 86400000).toISOString();
    const oppRes = await req("/opportunities", orgKey, {
      method: "POST",
      body: { name: `vitest-create-opp-${suffix}`, accountId, closeDate },
    });
    expect(oppRes.status).toBe(201);
    const opp = (await oppRes.json()).data;
    expect(opp.id).toMatch(/^OPP-/);
    createdIds.opportunities.push(opp.id);
  });

  it("creates a $0 opportunity with a date-only closeDate", async () => {
    const accountId = createdIds.accounts[0];
    const res = await req("/opportunities", orgKey, {
      method: "POST",
      body: {
        name: `vitest-create-zero-${suffix}`,
        accountId,
        closeDate: "2026-08-15",
        amount: 0,
        includeInForecast: false,
      },
    });
    expect(res.status).toBe(201);
    const opp = (await res.json()).data;
    expect(opp.amount).toBe("0.00");
    expect(opp.includeInForecast).toBe(false);
    createdIds.opportunities.push(opp.id);
  });

  it("rejects opportunity without closeDate", async () => {
    const res = await req("/opportunities", orgKey, {
      method: "POST",
      body: { name: "no-date", accountId: createdIds.accounts[0] },
    });
    expect(res.status).toBe(400);
  });

  it("does not write a contact against a cross-org accountId", async () => {
    const [foreign] = await db.insert(schema.accounts).values({
      id: `ACCT-FOREIGN-${suffix}`,
      name: `foreign-${suffix}`,
      organizationId: otherOrgId,
    }).returning();
    createdIds.accounts.push(foreign.id);
    const res = await req("/contacts", orgKey, {
      method: "POST",
      body: { firstName: "X", lastName: "Y", accountId: foreign.id },
    });
    expect(res.status).toBe(404);
  });
});
