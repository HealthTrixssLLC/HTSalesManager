/**
 * Integration tests for GET /api/permissions
 *
 * Verifies that:
 *   1. Unauthenticated requests are rejected with 401
 *   2. Authenticated user without orgId gets global permissions
 *   3. With an orgId, permissions reflect the org-effective role (not the global role)
 *   4. A user with different roles in two orgs gets different permissions per org
 *   5. Admin always gets wildcard permissions regardless of orgId
 *
 * This covers the critical org-switching scenario: a user who is "ReadOnly" in one
 * org and "SalesRep" in another must see visibility-gated UI controls change
 * appropriately when switching orgs.
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { db, storage } from "../server/db";
import { hashPassword } from "../server/auth";
import * as schema from "../shared/schema";
import { eq } from "drizzle-orm";

const BASE = "http://localhost:5000";

// ─── Helpers ────────────────────────────────────────────────────────────────

function extractCookies(headers: Headers): string {
  const parts: string[] = [];
  headers.forEach((value, key) => {
    if (key.toLowerCase() === "set-cookie") {
      parts.push(value.split(";")[0]);
    }
  });
  return parts.join("; ");
}

async function loginUser(email: string, password: string): Promise<{ cookieHeader: string }> {
  const csrfRes = await fetch(`${BASE}/api/csrf-token`);
  const csrfCookies = extractCookies(csrfRes.headers);
  const { csrfToken } = (await csrfRes.json()) as { csrfToken: string };

  const loginRes = await fetch(`${BASE}/api/login`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Cookie: csrfCookies,
      "X-CSRF-Token": csrfToken,
    },
    body: JSON.stringify({ email, password }),
  });

  if (!loginRes.ok) throw new Error(`Login failed: ${loginRes.status}`);
  const loginCookies = extractCookies(loginRes.headers);
  return { cookieHeader: [csrfCookies, loginCookies].filter(Boolean).join("; ") };
}

async function getPermissions(cookieHeader: string, orgId?: string): Promise<string[]> {
  const url = orgId ? `${BASE}/api/permissions?orgId=${encodeURIComponent(orgId)}` : `${BASE}/api/permissions`;
  const res = await fetch(url, { headers: { Cookie: cookieHeader } });
  if (!res.ok) throw new Error(`GET /api/permissions failed: ${res.status}`);
  const body = await res.json() as { permissions: string[] };
  return body.permissions;
}

// ─── Test data ───────────────────────────────────────────────────────────────

const TEST_PASSWORD = "permstest123!";

interface TestContext {
  userId: string;
  email: string;
  orgAId: string;
  orgBId: string;
  salesRepRoleId: string;
  readOnlyRoleId: string;
}

let ctx: TestContext;

beforeAll(async () => {
  // Resolve the role IDs we need
  const allRoles = await storage.getAllRoles();
  const salesRepRole = allRoles.find(r => r.name === "SalesRep");
  const readOnlyRole = allRoles.find(r => r.name === "ReadOnly");
  if (!salesRepRole || !readOnlyRole) throw new Error("Required roles not found in DB");

  const suffix = Date.now().toString();

  const hashedPw = await hashPassword(TEST_PASSWORD);

  // Create a test user with no global role (permissions come entirely from org membership)
  const [userRow] = await db
    .insert(schema.users)
    .values({
      name: `Perms Test ${suffix}`,
      email: `perms-test-${suffix}@example.com`,
      password: hashedPw,
      status: "active",
      authProvider: "password",
    })
    .returning({ id: schema.users.id });

  // Create two test organizations
  const [orgA] = await db
    .insert(schema.organizations)
    .values({ name: `Perms Org A ${suffix}`, slug: `perms-org-a-${suffix}` })
    .returning({ id: schema.organizations.id });

  const [orgB] = await db
    .insert(schema.organizations)
    .values({ name: `Perms Org B ${suffix}`, slug: `perms-org-b-${suffix}` })
    .returning({ id: schema.organizations.id });

  // Enroll user as SalesRep in org A, ReadOnly in org B
  await db.insert(schema.userOrganizations).values({
    userId: userRow.id,
    organizationId: orgA.id,
    roleId: salesRepRole.id,
    isDefault: true,
  });
  await db.insert(schema.userOrganizations).values({
    userId: userRow.id,
    organizationId: orgB.id,
    roleId: readOnlyRole.id,
    isDefault: false,
  });

  ctx = {
    userId: userRow.id,
    email: `perms-test-${suffix}@example.com`,
    orgAId: orgA.id,
    orgBId: orgB.id,
    salesRepRoleId: salesRepRole.id,
    readOnlyRoleId: readOnlyRole.id,
  };
});

afterAll(async () => {
  if (!ctx) return;
  // Cascade: memberships deleted by user deletion
  await db.delete(schema.users).where(eq(schema.users.id, ctx.userId));
  await db.delete(schema.organizations).where(eq(schema.organizations.id, ctx.orgAId));
  await db.delete(schema.organizations).where(eq(schema.organizations.id, ctx.orgBId));
});

// ─── Tests ───────────────────────────────────────────────────────────────────

describe("GET /api/permissions", () => {
  it("returns 401 for unauthenticated requests", async () => {
    const res = await fetch(`${BASE}/api/permissions`);
    expect(res.status).toBe(401);
  });

  it("returns empty permissions for a user with no global role and no orgId", async () => {
    const { cookieHeader } = await loginUser(ctx.email, TEST_PASSWORD);
    const perms = await getPermissions(cookieHeader);
    // No global role assigned → empty array (org-less context has no effective role)
    expect(perms).toEqual([]);
  });

  it("SalesRep org role includes create and update permissions", async () => {
    const { cookieHeader } = await loginUser(ctx.email, TEST_PASSWORD);
    const perms = await getPermissions(cookieHeader, ctx.orgAId);

    // SalesRep should be able to create, read, and update core CRM entities
    expect(perms).toContain("Account.read");
    expect(perms).toContain("Account.create");
    expect(perms).toContain("Account.update");
    expect(perms).toContain("Lead.convert");
  });

  it("ReadOnly org role excludes create and update permissions", async () => {
    const { cookieHeader } = await loginUser(ctx.email, TEST_PASSWORD);
    const perms = await getPermissions(cookieHeader, ctx.orgBId);

    // ReadOnly should be able to read but not write
    expect(perms).toContain("Account.read");
    expect(perms).not.toContain("Account.create");
    expect(perms).not.toContain("Account.update");
    expect(perms).not.toContain("Account.delete");
    expect(perms).not.toContain("Lead.convert");
  });

  it("same user gets different permissions for different orgs (org-switching correctness)", async () => {
    const { cookieHeader } = await loginUser(ctx.email, TEST_PASSWORD);
    const [permsA, permsB] = await Promise.all([
      getPermissions(cookieHeader, ctx.orgAId),
      getPermissions(cookieHeader, ctx.orgBId),
    ]);

    // Org A (SalesRep) has create; Org B (ReadOnly) does not
    expect(permsA).toContain("Account.create");
    expect(permsB).not.toContain("Account.create");

    // Both orgs allow read
    expect(permsA).toContain("Account.read");
    expect(permsB).toContain("Account.read");
  });

  it("Admin always gets wildcard permissions regardless of orgId", async () => {
    // Use the existing seeded admin account
    const { cookieHeader } = await loginUser("admin@test.com", "admin123");

    const [permsGlobal, permsOrgA] = await Promise.all([
      getPermissions(cookieHeader),
      getPermissions(cookieHeader, ctx.orgAId),
    ]);

    expect(permsGlobal).toContain("*.*");
    expect(permsOrgA).toContain("*.*");
  });

  it("returns 404 or empty for a non-existent orgId (no membership)", async () => {
    const { cookieHeader } = await loginUser(ctx.email, TEST_PASSWORD);
    const perms = await getPermissions(cookieHeader, "non-existent-org-id-xyz");
    // No membership → resolveEffectiveRoles returns [] → empty permissions
    expect(perms).toEqual([]);
  });
});
