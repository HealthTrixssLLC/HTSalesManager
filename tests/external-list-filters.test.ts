// Integration tests for Phase B external API list filters
// (Accounts, Contacts, Leads, Opportunities)
// Requires the dev server to be running on localhost:5000
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { db } from "../server/db";
import { generateApiKey } from "../server/api-key-utils";
import * as schema from "@shared/schema";
import { eq, inArray } from "drizzle-orm";

const BASE = "http://localhost:5000/api/v1/external";

const suffix = Date.now();
let orgKey: string;
let orgId: string;
let otherOrgId: string;
let userId: string;
let keyIds: string[] = [];

// Created record IDs for cleanup
const leadIds: string[] = [];
const accountIds: string[] = [];
const contactIds: string[] = [];
const oppIds: string[] = [];

function get(path: string) {
  return fetch(`${BASE}${path}`, { headers: { "x-api-key": orgKey } });
}

beforeAll(async () => {
  const orgs = await db.select().from(schema.organizations).limit(1);
  expect(orgs.length).toBeGreaterThan(0);
  orgId = orgs[0].id;

  const users = await db.select().from(schema.users).limit(1);
  userId = users[0].id;

  // Second org for isolation tests
  const [otherOrg] = await db.insert(schema.organizations)
    .values({ name: `vitest-filter-org-${suffix}`, slug: `vitest-filter-org-${suffix}` })
    .returning();
  otherOrgId = otherOrg.id;

  const k = generateApiKey();
  orgKey = k.publicKey;
  const inserted = await db.insert(schema.apiKeys).values([
    { hashedKey: k.hashedKey, name: "vitest-filter-key", isActive: true, organizationId: orgId, createdBy: userId },
  ]).returning({ id: schema.apiKeys.id });
  keyIds = inserted.map(r => r.id);

  // Seed data in the key's org
  const acctId = `ACCT-VTFILTER-${suffix}`;
  accountIds.push(acctId);
  await db.insert(schema.accounts).values({
    id: acctId, organizationId: orgId, name: `Vitest Filter Hospital ${suffix}`, type: "customer",
  });

  const contactId = `CONT-VTFILTER-${suffix}`;
  contactIds.push(contactId);
  await db.insert(schema.contacts).values({
    id: contactId, organizationId: orgId, accountId: acctId,
    firstName: "Filtera", lastName: `Testperson${suffix}`,
    email: `vitest-filter-contact-${suffix}@example.com`,
  });

  const leadId = `LEAD-VTFILTER-${suffix}`;
  leadIds.push(leadId);
  await db.insert(schema.leads).values({
    id: leadId, organizationId: orgId,
    firstName: "Filterlead", lastName: `Person${suffix}`,
    company: `FilterCo ${suffix}`,
    email: `vitest-filter-lead-${suffix}@example.com`,
    status: "qualified", source: "referral", rating: "hot",
  });

  const oppId = `OPP-VTFILTER-${suffix}`;
  oppIds.push(oppId);
  await db.insert(schema.opportunities).values({
    id: oppId, organizationId: orgId, accountId: acctId,
    name: `Vitest Filter Deal ${suffix}`, stage: "proposal",
    status: "Open", rating: "Warm", ownerId: userId,
    closeDate: new Date(Date.now() + 30 * 24 * 3600 * 1000),
    includeInForecast: true,
  });

  // Cross-org records with matching-looking data (isolation checks)
  const otherAcctId = `ACCT-VTFILTER-OTHER-${suffix}`;
  accountIds.push(otherAcctId);
  await db.insert(schema.accounts).values({
    id: otherAcctId, organizationId: otherOrgId, name: `Vitest Filter Hospital OTHER ${suffix}`,
  });

  const otherLeadId = `LEAD-VTFILTER-OTHER-${suffix}`;
  leadIds.push(otherLeadId);
  await db.insert(schema.leads).values({
    id: otherLeadId, organizationId: otherOrgId,
    firstName: "Filterlead", lastName: `Person${suffix}`,
    company: `FilterCo ${suffix}`, status: "qualified", source: "referral", rating: "hot",
  });

  const otherContactId = `CONT-VTFILTER-OTHER-${suffix}`;
  contactIds.push(otherContactId);
  await db.insert(schema.contacts).values({
    id: otherContactId, organizationId: otherOrgId, accountId: otherAcctId,
    firstName: "Filtera", lastName: `Testperson${suffix}`,
    email: `vitest-filter-contact-${suffix}@example.com`,
  });

  const otherOppId = `OPP-VTFILTER-OTHER-${suffix}`;
  oppIds.push(otherOppId);
  await db.insert(schema.opportunities).values({
    id: otherOppId, organizationId: otherOrgId, accountId: otherAcctId,
    name: `Vitest Filter Deal OTHER ${suffix}`, stage: "proposal",
    closeDate: new Date(), includeInForecast: true,
  });
});

afterAll(async () => {
  if (oppIds.length) await db.delete(schema.opportunities).where(inArray(schema.opportunities.id, oppIds));
  if (contactIds.length) await db.delete(schema.contacts).where(inArray(schema.contacts.id, contactIds));
  if (leadIds.length) await db.delete(schema.leads).where(inArray(schema.leads.id, leadIds));
  if (accountIds.length) await db.delete(schema.accounts).where(inArray(schema.accounts.id, accountIds));
  if (keyIds.length) await db.delete(schema.apiKeys).where(inArray(schema.apiKeys.id, keyIds));
  await db.delete(schema.organizations).where(eq(schema.organizations.id, otherOrgId));
});

describe("Accounts list filters", () => {
  it("filters by search (case-insensitive substring on name)", async () => {
    const res = await get(`/accounts?search=filter hospital ${suffix}&limit=1000`);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data.some((a: any) => a.id === accountIds[0])).toBe(true);
    // Cross-org account with matching name must not appear
    expect(body.data.some((a: any) => a.id === accountIds[1])).toBe(false);
  });

  it("filters by name", async () => {
    const res = await get(`/accounts?name=VITEST FILTER HOSPITAL ${suffix}&limit=1000`);
    const body = await res.json();
    expect(body.data.some((a: any) => a.id === accountIds[0])).toBe(true);
  });

  it("returns nothing for a non-matching search", async () => {
    const res = await get(`/accounts?search=zzz-no-such-account-${suffix}`);
    const body = await res.json();
    expect(body.data.length).toBe(0);
    expect(body.pagination.total).toBe(0);
  });

  it("returns 400 for invalid updatedSince", async () => {
    const res = await get(`/accounts?updatedSince=not-a-date`);
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toBe("Invalid updatedSince");
  });

  it.each([
    "2024-02-30T00:00:00Z",  // invalid calendar day (Feb 30)
    "2023-02-29T00:00:00Z",  // Feb 29 in a non-leap year
    "2024-13-01T00:00:00Z",  // month 13
    "2024-04-31T12:00:00Z",  // April 31
    "2024-01-01T25:00:00Z",  // hour 25
    "2024-01-01T00:61:00Z",  // minute 61
    "2024-1-01T00:00:00Z",   // non-padded month
    "20240101",              // compact form not accepted
    "2024-01-01 00:00:00Z",  // space instead of the ISO T separator
    "2024-01-01",            // date-only (time component required)
  ])("rejects invalid/normalizing timestamp %s with 400 on all four endpoints", async (ts) => {
    for (const entity of ["accounts", "contacts", "leads", "opportunities"]) {
      const res = await get(`/${entity}?updatedSince=${encodeURIComponent(ts)}`);
      expect(res.status, `${entity} should reject ${ts}`).toBe(400);
      const body = await res.json();
      expect(body.error).toBe("Invalid updatedSince");
    }
  });

  it("still accepts valid ISO timestamps (Z, offset, fractional seconds)", async () => {
    for (const ts of ["2024-02-29T00:00:00Z", "2024-01-01T00:00:00+02:00", "2024-01-01T00:00:00.123Z", "2024-01-01T00:00Z"]) {
      const res = await get(`/accounts?updatedSince=${encodeURIComponent(ts)}&limit=1`);
      expect(res.status, `accounts should accept ${ts}`).toBe(200);
    }
  });

  it("still supports expand=opportunities alongside filters", async () => {
    const res = await get(`/accounts?search=filter hospital ${suffix}&expand=opportunities`);
    const body = await res.json();
    const acct = body.data.find((a: any) => a.id === accountIds[0]);
    expect(acct).toBeTruthy();
    expect(Array.isArray(acct.opportunities)).toBe(true);
    expect(acct.opportunities.some((o: any) => o.id === oppIds[0])).toBe(true);
  });
});

describe("Contacts list filters", () => {
  it("filters by search on first+last name", async () => {
    const res = await get(`/contacts?search=filtera testperson${suffix}`);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data.length).toBe(1);
    expect(body.data[0].id).toBe(contactIds[0]);
  });

  it("filters by email (case-insensitive, org-isolated)", async () => {
    const res = await get(`/contacts?email=VITEST-FILTER-CONTACT-${suffix}@EXAMPLE.COM`);
    const body = await res.json();
    expect(body.data.length).toBe(1);
    expect(body.data[0].id).toBe(contactIds[0]); // not the cross-org contact with same email
  });

  it("filters by accountId", async () => {
    const res = await get(`/contacts?accountId=${accountIds[0]}`);
    const body = await res.json();
    expect(body.data.length).toBe(1);
    expect(body.data[0].id).toBe(contactIds[0]);
  });

  it("returns 400 for invalid updatedSince", async () => {
    const res = await get(`/contacts?updatedSince=garbage`);
    expect(res.status).toBe(400);
  });
});

describe("Leads list filters", () => {
  it("filters by search on name and company", async () => {
    const byName = await (await get(`/leads?search=filterlead person${suffix}`)).json();
    expect(byName.data.some((l: any) => l.id === leadIds[0])).toBe(true);
    expect(byName.data.every((l: any) => l.organizationId === orgId)).toBe(true);

    const byCompany = await (await get(`/leads?search=filterco ${suffix}`)).json();
    expect(byCompany.data.some((l: any) => l.id === leadIds[0])).toBe(true);
  });

  it("filters by email", async () => {
    const res = await get(`/leads?email=vitest-filter-lead-${suffix}@example.com`);
    const body = await res.json();
    expect(body.data.length).toBe(1);
    expect(body.data[0].id).toBe(leadIds[0]);
  });

  it("filters by status, rating, and source", async () => {
    const body = await (await get(`/leads?status=qualified&rating=hot&source=referral&limit=1000`)).json();
    expect(body.data.some((l: any) => l.id === leadIds[0])).toBe(true);
    for (const l of body.data) {
      expect(l.status).toBe("qualified");
      expect(l.rating).toBe("hot");
      expect(l.source).toBe("referral");
      expect(l.organizationId).toBe(orgId);
    }

    const none = await (await get(`/leads?email=vitest-filter-lead-${suffix}@example.com&status=converted`)).json();
    expect(none.data.length).toBe(0);
  });

  it("composes status with updatedSince", async () => {
    const past = new Date(Date.now() - 3600 * 1000).toISOString();
    const body = await (await get(`/leads?status=qualified&updatedSince=${encodeURIComponent(past)}&limit=1000`)).json();
    expect(body.data.some((l: any) => l.id === leadIds[0])).toBe(true);

    const future = new Date(Date.now() + 3600 * 1000).toISOString();
    const empty = await (await get(`/leads?status=qualified&updatedSince=${encodeURIComponent(future)}`)).json();
    expect(empty.data.length).toBe(0);
  });

  it("returns 400 for invalid enum values", async () => {
    for (const q of ["status=bogus", "rating=lukewarm", "source=carrier-pigeon", "updatedSince=nope"]) {
      const res = await get(`/leads?${q}`);
      expect(res.status).toBe(400);
      const body = await res.json();
      expect(body.message).toBeTruthy();
    }
  });
});

describe("Opportunities list filters", () => {
  it("filters by search", async () => {
    const body = await (await get(`/opportunities?search=vitest filter deal ${suffix}&limit=1000`)).json();
    expect(body.data.some((o: any) => o.id === oppIds[0])).toBe(true);
    // Cross-org opp (name contains same prefix) must not leak
    expect(body.data.some((o: any) => o.id === oppIds[1])).toBe(false);
  });

  it("filters by accountId, stage, ownerId, status, rating", async () => {
    const body = await (await get(
      `/opportunities?accountId=${accountIds[0]}&stage=proposal&ownerId=${userId}&status=open&rating=warm`
    )).json();
    expect(body.data.length).toBe(1);
    expect(body.data[0].id).toBe(oppIds[0]);
  });

  it("supports includeInForecast=all and false", async () => {
    const all = await get(`/opportunities?includeInForecast=all&limit=1000`);
    expect(all.status).toBe(200);
    const allBody = await all.json();
    expect(allBody.data.some((o: any) => o.id === oppIds[0])).toBe(true);

    const excluded = await (await get(`/opportunities?includeInForecast=false&search=vitest filter deal ${suffix}`)).json();
    expect(excluded.data.length).toBe(0);
  });

  it("returns 400 for invalid stage and includeInForecast", async () => {
    expect((await get(`/opportunities?stage=imaginary`)).status).toBe(400);
    expect((await get(`/opportunities?includeInForecast=maybe`)).status).toBe(400);
    expect((await get(`/opportunities?updatedSince=junk`)).status).toBe(400);
  });

  it("keeps default includeInForecast=true behavior and expand=account", async () => {
    const body = await (await get(`/opportunities?search=vitest filter deal ${suffix}&expand=account`)).json();
    expect(body.data.length).toBe(1);
    expect(body.data[0].includeInForecast).toBe(true);
    expect(body.data[0].account?.id).toBe(accountIds[0]);
  });
});

describe("Pagination clamping", () => {
  it("clamps negative limit to a positive page size", async () => {
    const res = await get(`/accounts?limit=-1`);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.pagination.limit).toBeGreaterThanOrEqual(1);
    expect(body.data.length).toBeLessThanOrEqual(body.pagination.limit);

    const opp = await (await get(`/opportunities?limit=-1&includeInForecast=all`)).json();
    expect(opp.pagination.limit).toBeGreaterThanOrEqual(1);

    const contacts = await (await get(`/contacts?limit=-5`)).json();
    expect(contacts.pagination.limit).toBeGreaterThanOrEqual(1);

    const leads = await (await get(`/leads?limit=0`)).json();
    expect(leads.pagination.limit).toBeGreaterThanOrEqual(1);
  });

  it("clamps negative offset to zero", async () => {
    const acc = await (await get(`/accounts?offset=-10`)).json();
    expect(acc.pagination.offset).toBe(0);

    const opp = await (await get(`/opportunities?offset=-10&includeInForecast=all`)).json();
    expect(opp.pagination.offset).toBe(0);
  });
});
