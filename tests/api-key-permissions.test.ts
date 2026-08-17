// Integration tests for Phase F — API key read/write permission scopes
// Requires the dev server to be running on localhost:5000
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { db } from "../server/db";
import { generateApiKey } from "../server/api-key-utils";
import * as schema from "@shared/schema";
import { inArray, sql } from "drizzle-orm";

const BASE = "http://localhost:5000/api/v1/external";

let readOnlyKey: string;
let fullKey: string;
let legacyKey: string;
let writeOnlyKey: string;
let zeroPermKey: string;
let orgId: string;
let keyIds: string[] = [];
const createdLeadIds: string[] = [];
const createdActivityIds: string[] = [];

function req(path: string, key: string, method = "GET", body?: any) {
  return fetch(`${BASE}${path}`, {
    method,
    headers: { "x-api-key": key, "Content-Type": "application/json" },
    body: body ? JSON.stringify(body) : undefined,
  });
}

const leadPayload = (suffix: string) => ({
  firstName: "Perm",
  lastName: `Test-${suffix}`,
  email: `vitest-perm-${suffix}-${Date.now()}@example.com`,
});

const activityPayload = {
  type: "note" as const,
  subject: "Permission test activity",
};

beforeAll(async () => {
  const orgs = await db.select().from(schema.organizations).limit(1);
  expect(orgs.length).toBeGreaterThan(0);
  orgId = orgs[0].id;

  const users = await db.select().from(schema.users).limit(1);
  expect(users.length).toBeGreaterThan(0);
  const userId = users[0].id;

  const k1 = generateApiKey();
  const k2 = generateApiKey();
  const k3 = generateApiKey();
  const k4 = generateApiKey();
  const k5 = generateApiKey();
  readOnlyKey = k1.publicKey;
  fullKey = k2.publicKey;
  legacyKey = k3.publicKey;
  writeOnlyKey = k4.publicKey;
  zeroPermKey = k5.publicKey;

  const inserted = await db.insert(schema.apiKeys).values([
    {
      hashedKey: k1.hashedKey,
      name: "vitest-readonly-key",
      isActive: true,
      organizationId: orgId,
      createdBy: userId,
      permissions: ["crm.read", "activities.read", "documents.read"],
    },
    {
      hashedKey: k2.hashedKey,
      name: "vitest-full-key",
      isActive: true,
      organizationId: orgId,
      createdBy: userId,
      permissions: [
        "crm.read", "crm.write",
        "activities.read", "activities.write",
        "documents.read", "documents.write",
      ],
    },
    {
      // Legacy key: explicit NULL permissions simulates keys created before Phase F
      hashedKey: k3.hashedKey,
      name: "vitest-legacy-key",
      isActive: true,
      organizationId: orgId,
      createdBy: userId,
      permissions: null,
    },
    {
      hashedKey: k4.hashedKey,
      name: "vitest-writeonly-key",
      isActive: true,
      organizationId: orgId,
      createdBy: userId,
      permissions: ["crm.write", "activities.write"],
    },
    {
      // Explicit empty array must mean ZERO permissions, not full access
      hashedKey: k5.hashedKey,
      name: "vitest-zeroperm-key",
      isActive: true,
      organizationId: orgId,
      createdBy: userId,
      permissions: [],
    },
  ]).returning({ id: schema.apiKeys.id });
  keyIds = inserted.map(r => r.id);
});

afterAll(async () => {
  if (createdActivityIds.length > 0) {
    await db.delete(schema.activities).where(inArray(schema.activities.id, createdActivityIds));
  }
  if (createdLeadIds.length > 0) {
    await db.delete(schema.leads).where(inArray(schema.leads.id, createdLeadIds));
  }
  if (keyIds.length > 0) {
    await db.delete(schema.apiKeys).where(inArray(schema.apiKeys.id, keyIds));
  }
});

describe("Read-only API key", () => {
  it("is allowed on GET /accounts (200)", async () => {
    const res = await req("/accounts", readOnlyKey);
    expect(res.status).toBe(200);
  });

  it("is allowed on GET /opportunities (200)", async () => {
    const res = await req("/opportunities", readOnlyKey);
    expect(res.status).toBe(200);
  });

  it("is allowed on GET /leads (200)", async () => {
    const res = await req("/leads", readOnlyKey);
    expect(res.status).toBe(200);
  });

  it("is blocked on POST /leads with 403 naming the missing permission", async () => {
    const res = await req("/leads", readOnlyKey, "POST", leadPayload("ro"));
    expect(res.status).toBe(403);
    const body = await res.json();
    expect(body.error).toBe("Insufficient permissions");
    expect(body.requiredPermission).toBe("crm.write");
    expect(body.message).toContain("crm.write");
  });

  it("is blocked on POST /activities with 403 naming the missing permission", async () => {
    const res = await req("/activities", readOnlyKey, "POST", activityPayload);
    expect(res.status).toBe(403);
    const body = await res.json();
    expect(body.error).toBe("Insufficient permissions");
    expect(body.requiredPermission).toBe("activities.write");
  });

  it("is blocked on POST /opportunities/:id/contacts (403 crm.write)", async () => {
    const res = await req("/opportunities/any-id/contacts", readOnlyKey, "POST", { contactId: "any" });
    expect(res.status).toBe(403);
    const body = await res.json();
    expect(body.requiredPermission).toBe("crm.write");
  });

  it("is blocked on DELETE /opportunities/:id/contacts/:contactId (403 crm.write)", async () => {
    const res = await req("/opportunities/any-id/contacts/any", readOnlyKey, "DELETE");
    expect(res.status).toBe(403);
    const body = await res.json();
    expect(body.requiredPermission).toBe("crm.write");
  });

  it("is blocked on every PATCH route with the matching write permission (403)", async () => {
    for (const [path, perm] of [
      ["/accounts/any-id", "crm.write"],
      ["/contacts/any-id", "crm.write"],
      ["/leads/any-id", "crm.write"],
      ["/opportunities/any-id", "crm.write"],
      ["/activities/any-id", "activities.write"],
    ] as const) {
      const res = await req(path, readOnlyKey, "PATCH", { name: "x" });
      expect(res.status, `PATCH ${path}`).toBe(403);
      const body = await res.json();
      expect(body.requiredPermission, `PATCH ${path}`).toBe(perm);
    }
  });
});

describe("Full-access API key", () => {
  it("is allowed on POST /leads (201)", async () => {
    const res = await req("/leads", fullKey, "POST", leadPayload("full"));
    expect(res.status).toBe(201);
    const body = await res.json();
    createdLeadIds.push(body.data.id);
  });

  it("is allowed on POST /activities (201)", async () => {
    const res = await req("/activities", fullKey, "POST", activityPayload);
    expect(res.status).toBe(201);
    const body = await res.json();
    createdActivityIds.push(body.data.id);
  });

  it("passes the permission gate on PATCH routes (not 403)", async () => {
    // Nonexistent IDs: authorized keys should reach the handler (404), never 403
    for (const path of ["/accounts/nonexistent-id", "/activities/nonexistent-id"]) {
      const res = await req(path, fullKey, "PATCH", { name: "x" });
      expect(res.status, `PATCH ${path}`).not.toBe(403);
    }
  });

  it("passes the permission gate on opportunity-contact mutations (not 403)", async () => {
    // Nonexistent IDs: authorized keys should reach the handler (404/400), never 403
    const post = await req("/opportunities/nonexistent-id/contacts", fullKey, "POST", { contactId: "nonexistent" });
    expect(post.status).not.toBe(403);
    const del = await req("/opportunities/nonexistent-id/contacts/nonexistent", fullKey, "DELETE");
    expect(del.status).not.toBe(403);
  });
});

describe("Write-only API key", () => {
  it("is blocked on GET /accounts with 403 naming crm.read", async () => {
    const res = await req("/accounts", writeOnlyKey);
    expect(res.status).toBe(403);
    const body = await res.json();
    expect(body.requiredPermission).toBe("crm.read");
  });

  it("is blocked on GET /leads (403)", async () => {
    const res = await req("/leads", writeOnlyKey);
    expect(res.status).toBe(403);
  });

  it("is allowed on POST /leads (201)", async () => {
    const res = await req("/leads", writeOnlyKey, "POST", leadPayload("wo"));
    expect(res.status).toBe(201);
    const body = await res.json();
    createdLeadIds.push(body.data.id);
  });
});

describe("Empty-permissions API key", () => {
  it("is blocked on reads (403) — empty array is NOT promoted to full access", async () => {
    const res = await req("/accounts", zeroPermKey);
    expect(res.status).toBe(403);
    const body = await res.json();
    expect(body.requiredPermission).toBe("crm.read");
  });

  it("is blocked on writes (403)", async () => {
    const res = await req("/leads", zeroPermKey, "POST", leadPayload("zero"));
    expect(res.status).toBe(403);
    const body = await res.json();
    expect(body.requiredPermission).toBe("crm.write");
  });

  it("is blocked on opportunity-contact mutations (403)", async () => {
    const post = await req("/opportunities/any-id/contacts", zeroPermKey, "POST", { contactId: "any" });
    expect(post.status).toBe(403);
    const del = await req("/opportunities/any-id/contacts/any", zeroPermKey, "DELETE");
    expect(del.status).toBe(403);
  });

  it("is blocked on every PATCH route (403)", async () => {
    for (const path of ["/accounts/any-id", "/contacts/any-id", "/leads/any-id", "/opportunities/any-id", "/activities/any-id"]) {
      const res = await req(path, zeroPermKey, "PATCH", { name: "x" });
      expect(res.status, `PATCH ${path}`).toBe(403);
    }
  });
});

describe("API key creation validation", () => {
  it("insertApiKeySchema rejects an explicit empty permissions array", () => {
    const result = schema.insertApiKeySchema.safeParse({
      hashedKey: "x",
      name: "empty-perms",
      createdBy: "user",
      permissions: [],
    });
    expect(result.success).toBe(false);
  });

  it("insertApiKeySchema accepts null permissions (legacy)", () => {
    const result = schema.insertApiKeySchema.safeParse({
      hashedKey: "x",
      name: "legacy-perms",
      createdBy: "user",
      permissions: null,
    });
    expect(result.success).toBe(true);
  });
});

describe("Legacy API key (no permissions field)", () => {
  it("has NULL permissions in the database", async () => {
    const rows = await db.select({ permissions: schema.apiKeys.permissions })
      .from(schema.apiKeys)
      .where(sql`${schema.apiKeys.name} = 'vitest-legacy-key'`);
    expect(rows[0].permissions).toBeNull();
  });

  it("is allowed on POST /leads (backward compatible, 201)", async () => {
    const res = await req("/leads", legacyKey, "POST", leadPayload("legacy"));
    expect(res.status).toBe(201);
    const body = await res.json();
    createdLeadIds.push(body.data.id);
  });

  it("is allowed on POST /activities (backward compatible, 201)", async () => {
    const res = await req("/activities", legacyKey, "POST", activityPayload);
    expect(res.status).toBe(201);
    const body = await res.json();
    createdActivityIds.push(body.data.id);
  });

  it("is allowed on GET /accounts (200)", async () => {
    const res = await req("/accounts", legacyKey);
    expect(res.status).toBe(200);
  });
});
