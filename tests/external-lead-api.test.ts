// Integration tests for the external lead creation API
// Requires the dev server to be running on localhost:5000
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { db } from "../server/db";
import { generateApiKey } from "../server/api-key-utils";
import * as schema from "@shared/schema";
import { eq, like, inArray } from "drizzle-orm";

const BASE = "http://localhost:5000/api/v1/external";

let orgKey: string;
let sysKey: string;
let orgId: string;
let keyIds: string[] = [];
let createdLeadIds: string[] = [];
const testEmail = `vitest-lead-${Date.now()}@example.com`;

beforeAll(async () => {
  const orgs = await db.select().from(schema.organizations).limit(1);
  expect(orgs.length).toBeGreaterThan(0);
  orgId = orgs[0].id;

  const users = await db.select().from(schema.users).limit(1);
  expect(users.length).toBeGreaterThan(0);
  const userId = users[0].id;

  const k1 = generateApiKey();
  const k2 = generateApiKey();
  orgKey = k1.publicKey;
  sysKey = k2.publicKey;

  const inserted = await db.insert(schema.apiKeys).values([
    { hashedKey: k1.hashedKey, name: "vitest-org-key", isActive: true, organizationId: orgId, createdBy: userId },
    { hashedKey: k2.hashedKey, name: "vitest-system-key", isActive: true, organizationId: null, createdBy: userId },
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

function post(body: any, key: string) {
  return fetch(`${BASE}/leads`, {
    method: "POST",
    headers: { "x-api-key": key, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("External Lead API", () => {
  it("creates a lead with an org-bound key", async () => {
    const res = await post({
      firstName: "Vitest",
      lastName: "Lead",
      email: testEmail,
      company: "Test Co",
      source: "website",
      topic: "Automated test",
    }, orgKey);
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.duplicate).toBe(false);
    expect(body.data.id).toMatch(/^LEAD-/);
    expect(body.data.organizationId).toBe(orgId);
    expect(body.data.organizationName).toBeTruthy();
    expect(body.data.firstName).toBe("Vitest");
    expect(body.data.source).toBe("website");
    createdLeadIds.push(body.data.id);
  });

  it("returns the existing lead on duplicate email (case-insensitive)", async () => {
    const res = await post({
      firstName: "Other",
      lastName: "Person",
      email: testEmail.toUpperCase(),
    }, orgKey);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.duplicate).toBe(true);
    expect(body.data.id).toBe(createdLeadIds[0]);
  });

  it("rejects invalid payloads with field-level errors", async () => {
    const res = await post({ firstName: "", email: "not-an-email", source: "bogus" }, orgKey);
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toBe("Validation failed");
    const fields = body.details.map((d: any) => d.field);
    expect(fields).toContain("firstName");
    expect(fields).toContain("lastName");
    expect(fields).toContain("email");
    expect(fields).toContain("source");
  });

  it("rejects unknown fields (strict schema)", async () => {
    const res = await post({ firstName: "A", lastName: "B", organizationId: "hacked-org" }, orgKey);
    expect(res.status).toBe(400);
  });

  it("rejects system (non-org) keys with 403", async () => {
    const res = await post({ firstName: "A", lastName: "B" }, sysKey);
    expect(res.status).toBe(403);
    const body = await res.json();
    expect(body.error).toBe("Organization-bound API key required");
  });

  it("rejects invalid API keys with 401", async () => {
    const res = await post({ firstName: "A", lastName: "B" }, "htcrm_invalidinvalidinvalidinvalidinvalidkey");
    expect(res.status).toBe(401);
  });

  it("reads back a created lead by ID", async () => {
    const res = await fetch(`${BASE}/leads/${createdLeadIds[0]}`, { headers: { "x-api-key": orgKey } });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data.id).toBe(createdLeadIds[0]);
    expect(body.data.email).toBe(testEmail);
  });

  it("returns 404 for a lead in another organization", async () => {
    // Create a lead directly in a different (temp) org and try to fetch it with the org key
    const [tempOrg] = await db.insert(schema.organizations).values({ name: `vitest-temp-org-${Date.now()}`, slug: `vitest-temp-org-${Date.now()}` }).returning();
    const leadId = `LEAD-VITEST-${Date.now()}`;
    await db.insert(schema.leads).values({
      id: leadId,
      firstName: "Cross",
      lastName: "Org",
      organizationId: tempOrg.id,
    });
    try {
      const res = await fetch(`${BASE}/leads/${leadId}`, { headers: { "x-api-key": orgKey } });
      expect(res.status).toBe(404);
    } finally {
      await db.delete(schema.leads).where(eq(schema.leads.id, leadId));
      await db.delete(schema.organizations).where(eq(schema.organizations.id, tempOrg.id));
    }
  });

  it("filters leads by updatedSince", async () => {
    // A timestamp in the past must include the created lead
    const past = new Date(Date.now() - 60 * 60 * 1000).toISOString();
    const resPast = await fetch(`${BASE}/leads?updatedSince=${encodeURIComponent(past)}&limit=1000`, { headers: { "x-api-key": orgKey } });
    expect(resPast.status).toBe(200);
    const bodyPast = await resPast.json();
    expect(bodyPast.data.some((l: any) => l.id === createdLeadIds[0])).toBe(true);

    // A timestamp in the future must exclude everything
    const future = new Date(Date.now() + 60 * 60 * 1000).toISOString();
    const resFuture = await fetch(`${BASE}/leads?updatedSince=${encodeURIComponent(future)}&limit=1000`, { headers: { "x-api-key": orgKey } });
    const bodyFuture = await resFuture.json();
    expect(bodyFuture.data.length).toBe(0);

    // Invalid timestamp → 400
    const resBad = await fetch(`${BASE}/leads?updatedSince=not-a-date`, { headers: { "x-api-key": orgKey } });
    expect(resBad.status).toBe(400);
  });

  it("lists leads scoped to the key's org", async () => {
    const res = await fetch(`${BASE}/leads?limit=1000`, { headers: { "x-api-key": orgKey } });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(Array.isArray(body.data)).toBe(true);
    expect(body.data.every((l: any) => l.organizationId === orgId)).toBe(true);
    expect(body.data.some((l: any) => l.id === createdLeadIds[0])).toBe(true);
  });
});
