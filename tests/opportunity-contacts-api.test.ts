// Integration tests for the Opportunity-Contact relationship External API (Phase C)
// Requires the dev server to be running on localhost:5000
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { db } from "../server/db";
import { generateApiKey } from "../server/api-key-utils";
import * as schema from "@shared/schema";
import { eq, inArray, and } from "drizzle-orm";

const BASE = "http://localhost:5000/api/v1/external";

let orgKey: string;
let orgId: string;
let otherOrgId: string;
let keyIds: string[] = [];
let accountId: string;
let oppId: string;
let contactAId: string;
let contactBId: string;
let otherOrgAccountId: string;
let otherOrgContactId: string;
const ts = Date.now();

beforeAll(async () => {
  const orgs = await db.select().from(schema.organizations).limit(1);
  expect(orgs.length).toBeGreaterThan(0);
  orgId = orgs[0].id;

  const users = await db.select().from(schema.users).limit(1);
  const userId = users[0].id;

  const k1 = generateApiKey();
  orgKey = k1.publicKey;
  const inserted = await db.insert(schema.apiKeys).values([
    { hashedKey: k1.hashedKey, name: "vitest-oc-org-key", isActive: true, organizationId: orgId, createdBy: userId },
  ]).returning({ id: schema.apiKeys.id });
  keyIds = inserted.map(r => r.id);

  // Test data in the key's org
  accountId = `ACCT-VITEST-OC-${ts}`;
  await db.insert(schema.accounts).values({ id: accountId, organizationId: orgId, name: "Vitest OC Account" });
  oppId = `OPP-VITEST-OC-${ts}`;
  await db.insert(schema.opportunities).values({
    id: oppId, organizationId: orgId, accountId, name: "Vitest OC Opp", closeDate: new Date(),
  });
  contactAId = `CONT-VITEST-OC-A-${ts}`;
  contactBId = `CONT-VITEST-OC-B-${ts}`;
  await db.insert(schema.contacts).values([
    { id: contactAId, organizationId: orgId, firstName: "Alice", lastName: "Alpha", email: `oc-a-${ts}@example.com` },
    { id: contactBId, organizationId: orgId, firstName: "Bob", lastName: "Beta", email: `oc-b-${ts}@example.com` },
  ]);

  // Another org with its own contact (for org-boundary tests)
  const [tempOrg] = await db.insert(schema.organizations).values({
    name: `vitest-oc-org-${ts}`, slug: `vitest-oc-org-${ts}`,
  }).returning();
  otherOrgId = tempOrg.id;
  otherOrgAccountId = `ACCT-VITEST-OC-X-${ts}`;
  await db.insert(schema.accounts).values({ id: otherOrgAccountId, organizationId: otherOrgId, name: "Other Org Account" });
  otherOrgContactId = `CONT-VITEST-OC-X-${ts}`;
  await db.insert(schema.contacts).values({
    id: otherOrgContactId, organizationId: otherOrgId, firstName: "Xeno", lastName: "Cross", email: `oc-x-${ts}@example.com`,
  });
});

afterAll(async () => {
  await db.delete(schema.opportunityContacts).where(eq(schema.opportunityContacts.opportunityId, oppId));
  await db.delete(schema.opportunities).where(eq(schema.opportunities.id, oppId));
  await db.delete(schema.contacts).where(inArray(schema.contacts.id, [contactAId, contactBId, otherOrgContactId]));
  await db.delete(schema.accounts).where(inArray(schema.accounts.id, [accountId, otherOrgAccountId]));
  await db.delete(schema.organizations).where(eq(schema.organizations.id, otherOrgId));
  if (keyIds.length > 0) {
    await db.delete(schema.apiKeys).where(inArray(schema.apiKeys.id, keyIds));
  }
});

function link(oppIdArg: string, body: any) {
  return fetch(`${BASE}/opportunities/${oppIdArg}/contacts`, {
    method: "POST",
    headers: { "x-api-key": orgKey, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

function unlink(oppIdArg: string, contactId: string) {
  return fetch(`${BASE}/opportunities/${oppIdArg}/contacts/${contactId}`, {
    method: "DELETE",
    headers: { "x-api-key": orgKey },
  });
}

describe("Opportunity-Contact External API", () => {
  it("links a contact to an opportunity with a role", async () => {
    const res = await link(oppId, { contactId: contactAId, role: "champion", isPrimary: true });
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.data.opportunityId).toBe(oppId);
    expect(body.data.contactId).toBe(contactAId);
    expect(body.data.role).toBe("champion");
    expect(body.data.isPrimary).toBe(true);
  });

  it("rejects duplicate links with 409", async () => {
    const res = await link(oppId, { contactId: contactAId, role: "economic_buyer" });
    expect(res.status).toBe(409);
  });

  it("rejects invalid role values with 400", async () => {
    const res = await link(oppId, { contactId: contactBId, role: "bogus_role" });
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toBe("Validation failed");
    expect(body.details.some((d: any) => d.field === "role")).toBe(true);
  });

  it("rejects missing contactId with 400", async () => {
    const res = await link(oppId, { role: "champion" });
    expect(res.status).toBe(400);
  });

  it("cannot link a contact from a different org (404, no info leak)", async () => {
    const res = await link(oppId, { contactId: otherOrgContactId, role: "champion" });
    expect(res.status).toBe(404);
    // Ensure no row was created
    const rows = await db.select().from(schema.opportunityContacts)
      .where(and(
        eq(schema.opportunityContacts.opportunityId, oppId),
        eq(schema.opportunityContacts.contactId, otherOrgContactId),
      ));
    expect(rows.length).toBe(0);
  });

  it("enforces only one primary contact per opportunity", async () => {
    // Link second contact as primary — first contact must be demoted
    const res = await link(oppId, { contactId: contactBId, role: "decision_maker", isPrimary: true });
    expect(res.status).toBe(201);
    const rows = await db.select().from(schema.opportunityContacts)
      .where(eq(schema.opportunityContacts.opportunityId, oppId));
    const primaries = rows.filter(r => r.isPrimary);
    expect(primaries.length).toBe(1);
    expect(primaries[0].contactId).toBe(contactBId);
  });

  it("returns contacts via expand=contacts with role and isPrimary", async () => {
    const res = await fetch(`${BASE}/opportunities/${oppId}?expand=contacts`, {
      headers: { "x-api-key": orgKey },
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(Array.isArray(body.contacts ?? body.data.contacts)).toBe(true);
    const contacts = body.data.contacts;
    expect(contacts.length).toBe(2);
    const a = contacts.find((c: any) => c.contactId === contactAId);
    const b = contacts.find((c: any) => c.contactId === contactBId);
    expect(a.role).toBe("champion");
    expect(a.isPrimary).toBe(false);
    expect(a.firstName).toBe("Alice");
    expect(b.role).toBe("decision_maker");
    expect(b.isPrimary).toBe(true);
  });

  it("omits contacts when expand is not requested", async () => {
    const res = await fetch(`${BASE}/opportunities/${oppId}`, { headers: { "x-api-key": orgKey } });
    const body = await res.json();
    expect(body.data.contacts).toBeUndefined();
  });

  it("unlinks a contact without deleting the contact record", async () => {
    const res = await unlink(oppId, contactAId);
    expect(res.status).toBe(204);
    // Relationship gone
    const rows = await db.select().from(schema.opportunityContacts)
      .where(and(
        eq(schema.opportunityContacts.opportunityId, oppId),
        eq(schema.opportunityContacts.contactId, contactAId),
      ));
    expect(rows.length).toBe(0);
    // Contact record still exists
    const contacts = await db.select().from(schema.contacts).where(eq(schema.contacts.id, contactAId));
    expect(contacts.length).toBe(1);
  });

  it("returns 404 when unlinking a non-linked contact", async () => {
    const res = await unlink(oppId, contactAId);
    expect(res.status).toBe(404);
  });

  it("returns 404 for an opportunity in another org", async () => {
    const otherOppId = `OPP-VITEST-OC-X-${ts}`;
    await db.insert(schema.opportunities).values({
      id: otherOppId, organizationId: otherOrgId, accountId: otherOrgAccountId,
      name: "Other Org Opp", closeDate: new Date(),
    });
    try {
      const res = await link(otherOppId, { contactId: otherOrgContactId, role: "champion" });
      expect(res.status).toBe(404);
      const resGet = await fetch(`${BASE}/opportunities/${otherOppId}?expand=contacts`, { headers: { "x-api-key": orgKey } });
      expect(resGet.status).toBe(404);
    } finally {
      await db.delete(schema.opportunities).where(eq(schema.opportunities.id, otherOppId));
    }
  });
});
