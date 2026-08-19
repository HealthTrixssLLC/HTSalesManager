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
let sysKey: string;
let keyIds: string[] = [];
let leadIds: string[] = [];
let created = { accounts: [] as string[], contacts: [] as string[], opportunities: [] as string[] };

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
    .values({ name: `vitest-convert-org-${suffix}`, slug: `vitest-convert-org-${suffix}` }).returning();
  orgId = org.id;
  const [other] = await db.insert(schema.organizations)
    .values({ name: `vitest-convert-other-${suffix}`, slug: `vitest-convert-other-${suffix}` }).returning();
  otherOrgId = other.id;
  const k1 = generateApiKey();
  const k2 = generateApiKey();
  orgKey = k1.publicKey;
  sysKey = k2.publicKey;
  const inserted = await db.insert(schema.apiKeys).values([
    { hashedKey: k1.hashedKey, name: `vitest-convert-org-${suffix}`, isActive: true, organizationId: orgId, createdBy: userId },
    { hashedKey: k2.hashedKey, name: `vitest-convert-sys-${suffix}`, isActive: true, organizationId: null, createdBy: userId },
  ]).returning({ id: schema.apiKeys.id });
  keyIds = inserted.map(r => r.id);
});

afterAll(async () => {
  if (leadIds.length) await db.delete(schema.leads).where(inArray(schema.leads.id, leadIds));
  if (created.opportunities.length) await db.delete(schema.opportunities).where(inArray(schema.opportunities.id, created.opportunities));
  if (created.contacts.length) await db.delete(schema.contacts).where(inArray(schema.contacts.id, created.contacts));
  if (created.accounts.length) await db.delete(schema.accounts).where(inArray(schema.accounts.id, created.accounts));
  if (keyIds.length) await db.delete(schema.apiKeys).where(inArray(schema.apiKeys.id, keyIds));
  await db.delete(schema.organizations).where(inArray(schema.organizations.id, [orgId, otherOrgId]));
});

async function seedLead(label: string) {
  const [lead] = await db.insert(schema.leads).values({
    id: `LEAD-VT${suffix.toString().slice(-6)}${label}`,
    firstName: "Convert",
    lastName: label,
    company: `Co ${label}`,
    email: `convert-${label}-${suffix}@example.com`,
    status: "qualified",
    organizationId: orgId,
  }).returning();
  leadIds.push(lead.id);
  return lead;
}

describe("External convert API", () => {
  it("converts a lead to account, contact, and opportunity", async () => {
    const lead = await seedLead("A");
    const res = await req(`/leads/${lead.id}/convert`, orgKey, {
      method: "POST",
      body: { createOpportunity: true },
    });
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.converted).toBe(true);
    expect(body.created).toBe(true);
    expect(body.data.lead.status).toBe("converted");
    expect(body.data.accountId).toMatch(/^ACCT-/);
    expect(body.data.contactId).toMatch(/^CONT-/);
    expect(body.data.opportunityId).toMatch(/^OPP-/);
    created.accounts.push(body.data.accountId);
    created.contacts.push(body.data.contactId);
    created.opportunities.push(body.data.opportunityId);
  });

  it("replays an already-converted lead without creating more rows", async () => {
    const lead = await seedLead("B");
    const first = await req(`/leads/${lead.id}/convert`, orgKey, { method: "POST", body: {} });
    expect(first.status).toBe(201);
    const createdBody = await first.json();
    created.accounts.push(createdBody.data.accountId);
    created.contacts.push(createdBody.data.contactId);
    const contactCount = (await db.select().from(schema.contacts).where(eq(schema.contacts.organizationId, orgId))).length;
    const second = await req(`/leads/${lead.id}/convert`, orgKey, { method: "POST", body: {} });
    expect(second.status).toBe(200);
    const replay = await second.json();
    expect(replay.created).toBe(false);
    expect(replay.data.accountId).toBe(createdBody.data.accountId);
    const contactCountAfter = (await db.select().from(schema.contacts).where(eq(schema.contacts.organizationId, orgId))).length;
    expect(contactCountAfter).toBe(contactCount);
  });

  it("rejects a system key", async () => {
    const lead = await seedLead("C");
    const res = await req(`/leads/${lead.id}/convert`, sysKey, { method: "POST", body: {} });
    expect(res.status).toBe(403);
  });

  it("rejects a non-canonical lead id", async () => {
    const res = await req(`/leads/not-a-lead/convert`, orgKey, { method: "POST", body: {} });
    expect(res.status).toBe(404);
  });

  it("rejects a legacy accountId on convert and does not mutate the lead", async () => {
    const lead = await seedLead("D");
    const res = await req(`/leads/${lead.id}/convert`, orgKey, {
      method: "POST",
      body: { accountId: "ACT-LEGACY-NOT-REAL" },
    });
    expect(res.status).toBe(404);
    const [fresh] = await db.select().from(schema.leads).where(eq(schema.leads.id, lead.id));
    expect(fresh.status).not.toBe("converted");
  });
});
