/**
 * Targeted integration tests for the password-reset flow (Task #158).
 *
 * Tests:
 *   1. Password user can request a reset → 200, token written to DB
 *   2. SSO user (authProvider=entra_sso) is silently excluded → 200, no token
 *   3. Admin-provisioned SSO user (set via PATCH) is excluded after re-classification
 *   4. Invalid / unknown email → 200, enumeration-safe
 *   5. Missing email body → 400
 *   6. Valid token resets password → 200, can log in with new password
 *   7. Expired token → 400
 *   8. Used (already-consumed) token → 400
 *   9. Concurrent claim — only one succeeds (single-use guarantee)
 *  10. Short password rejected → 400
 *
 * Run: npx tsx --config tests/vitest.server.config.ts tests/password-reset.test.ts
 */

import { describe, it, expect, beforeAll, afterAll, afterEach } from "vitest";
import crypto from "crypto";
import { db } from "../server/db";
import { storage } from "../server/db";
import * as schema from "../shared/schema";
import { eq, and } from "drizzle-orm";

// ────────────────────────────────────────────────────────────────────────────
// Helpers
// ────────────────────────────────────────────────────────────────────────────

const BASE = "http://localhost:5000";

async function post(path: string, body: unknown) {
  return fetch(`${BASE}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

interface AdminSession {
  cookieHeader: string;
  csrfToken: string;
}

/** Collect all Set-Cookie name=value pairs from a response, handling duplicates. */
function extractCookies(headers: Headers): string {
  const parts: string[] = [];
  headers.forEach((value, key) => {
    if (key.toLowerCase() === "set-cookie") {
      parts.push(value.split(";")[0]);
    }
  });
  return parts.join("; ");
}

/**
 * Establish an authenticated admin session.
 * Order matters: CSRF token → login (CSRF required) → combine cookies.
 */
async function getAdminSession(): Promise<AdminSession> {
  // 1. Get CSRF token (returned in response body + cookie)
  const csrfRes = await fetch(`${BASE}/api/csrf-token`);
  const csrfCookies = extractCookies(csrfRes.headers);
  const { csrfToken } = (await csrfRes.json()) as { csrfToken: string };

  // 2. Log in — login itself is CSRF-exempt but we include the token for consistency
  const loginRes = await fetch(`${BASE}/api/login`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Cookie: csrfCookies,
      "X-CSRF-Token": csrfToken,
    },
    body: JSON.stringify({ email: "admin@test.com", password: "admin123" }),
  });
  const loginCookies = extractCookies(loginRes.headers);
  const cookieHeader = [csrfCookies, loginCookies].filter(Boolean).join("; ");

  return { cookieHeader, csrfToken };
}

async function adminPatch(path: string, body: unknown, session: AdminSession) {
  return fetch(`${BASE}${path}`, {
    method: "PATCH",
    headers: {
      "Content-Type": "application/json",
      Cookie: session.cookieHeader,
      "X-CSRF-Token": session.csrfToken,
    },
    body: JSON.stringify(body),
  });
}

async function adminPost(path: string, body: unknown, session: AdminSession) {
  return fetch(`${BASE}${path}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Cookie: session.cookieHeader,
      "X-CSRF-Token": session.csrfToken,
    },
    body: JSON.stringify(body),
  });
}

async function adminGet(path: string, session: AdminSession) {
  return fetch(`${BASE}${path}`, {
    headers: { Cookie: session.cookieHeader },
  });
}

/** Create a throw-away test user and return its id + email. */
async function createTestUser(opts: {
  authProvider?: "password" | "entra_sso";
  suffix?: string;
} = {}): Promise<{ id: string; email: string }> {
  const suffix = opts.suffix ?? Date.now().toString();
  const email = `reset-test-${suffix}@example.com`;
  const hashedPw = "$2b$10$wVBRXDqWlWdXJoJoNgPk5.RHx0oNOGIvBhlwbNT3K5eTJ/GOeKwkC"; // bcrypt of "password123"

  const [row] = await db
    .insert(schema.users)
    .values({
      name: `Reset Test ${suffix}`,
      email,
      password: hashedPw,
      status: "active",
      authProvider: opts.authProvider ?? "password",
    })
    .returning({ id: schema.users.id });

  return { id: row.id, email };
}

/** Delete all password reset tokens and the user created for a test. */
async function cleanupUser(userId: string) {
  await db
    .delete(schema.passwordResetTokens)
    .where(eq(schema.passwordResetTokens.userId, userId));
  await db.delete(schema.users).where(eq(schema.users.id, userId));
}

/** Insert a token directly into the DB — lets us test expiry / used states. */
async function insertToken(opts: {
  userId: string;
  rawToken: string;
  expiresAt: Date;
  usedAt?: Date;
}) {
  const tokenHash = crypto
    .createHash("sha256")
    .update(opts.rawToken)
    .digest("hex");
  await db.insert(schema.passwordResetTokens).values({
    userId: opts.userId,
    tokenHash,
    expiresAt: opts.expiresAt,
    usedAt: opts.usedAt ?? null,
  });
  return tokenHash;
}

// ────────────────────────────────────────────────────────────────────────────
// Tests
// ────────────────────────────────────────────────────────────────────────────

describe("Password Reset Flow", () => {
  // ── 1. Password user: valid request ───────────────────────────────────────
  it("password user: request creates a token in DB and returns 200", async () => {
    const user = await createTestUser({ suffix: "pw-1" });
    try {
      const res = await post("/api/auth/forgot-password", { email: user.email });
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.success).toBe(true);

      const tokens = await db
        .select()
        .from(schema.passwordResetTokens)
        .where(
          and(
            eq(schema.passwordResetTokens.userId, user.id),
            // usedAt IS NULL
            // expiresAt in the future
          ),
        );
      expect(tokens.length).toBe(1);
      expect(tokens[0].usedAt).toBeNull();
      expect(new Date(tokens[0].expiresAt) > new Date()).toBe(true);
    } finally {
      await cleanupUser(user.id);
    }
  });

  // ── 2. SSO user silently excluded ─────────────────────────────────────────
  it("SSO user: returns 200 but no token is created", async () => {
    const user = await createTestUser({ authProvider: "entra_sso", suffix: "sso-2" });
    try {
      const res = await post("/api/auth/forgot-password", { email: user.email });
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.success).toBe(true);

      const tokens = await db
        .select()
        .from(schema.passwordResetTokens)
        .where(eq(schema.passwordResetTokens.userId, user.id));
      expect(tokens.length).toBe(0);
    } finally {
      await cleanupUser(user.id);
    }
  });

  // ── 3. Admin re-classifies user to SSO → excluded ─────────────────────────
  it("admin-provisioned SSO user: excluded after authProvider update via PATCH", async () => {
    const user = await createTestUser({ authProvider: "password", suffix: "admin-3" });
    const session = await getAdminSession();
    try {
      // Re-classify via admin PATCH
      const patchRes = await adminPatch(
        `/api/admin/users/${user.id}`,
        { authProvider: "entra_sso" },
        session,
      );
      expect(patchRes.status).toBe(200);
      const updated = await patchRes.json();
      expect(updated.authProvider).toBe("entra_sso");

      // Now the user must be excluded from reset
      const res = await post("/api/auth/forgot-password", { email: user.email });
      expect(res.status).toBe(200);

      const tokens = await db
        .select()
        .from(schema.passwordResetTokens)
        .where(eq(schema.passwordResetTokens.userId, user.id));
      expect(tokens.length).toBe(0);
    } finally {
      await cleanupUser(user.id);
    }
  });

  // ── 4. Unknown email → enumeration-safe 200 ───────────────────────────────
  it("unknown email: returns 200 without disclosing non-existence", async () => {
    const res = await post("/api/auth/forgot-password", {
      email: "nobody-at-all-" + Date.now() + "@example.com",
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.success).toBe(true);
  });

  // ── 5. Missing email body → 400 ───────────────────────────────────────────
  it("missing email: returns 400", async () => {
    const res = await post("/api/auth/forgot-password", {});
    expect(res.status).toBe(400);
  });

  // ── 6. Valid token resets password ────────────────────────────────────────
  it("valid token: resets password and can authenticate with new password", async () => {
    const user = await createTestUser({ suffix: "reset-6" });
    const rawToken = crypto.randomBytes(32).toString("hex");
    await insertToken({
      userId: user.id,
      rawToken,
      expiresAt: new Date(Date.now() + 60 * 60 * 1000),
    });
    try {
      const res = await post("/api/auth/reset-password", {
        token: rawToken,
        newPassword: "NewPassword999!",
      });
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.success).toBe(true);

      // Token must be marked used in DB
      const tokens = await db
        .select()
        .from(schema.passwordResetTokens)
        .where(eq(schema.passwordResetTokens.userId, user.id));
      expect(tokens[0].usedAt).not.toBeNull();

      // New password must work for login
      const loginRes = await post("/api/login", {
        email: user.email,
        password: "NewPassword999!",
      });
      expect(loginRes.status).toBe(200);
    } finally {
      await cleanupUser(user.id);
    }
  });

  // ── 7. Expired token → 400 ────────────────────────────────────────────────
  it("expired token: returns 400 without changing password", async () => {
    const user = await createTestUser({ suffix: "exp-7" });
    const rawToken = crypto.randomBytes(32).toString("hex");
    await insertToken({
      userId: user.id,
      rawToken,
      expiresAt: new Date(Date.now() - 1000), // already expired
    });
    try {
      const res = await post("/api/auth/reset-password", {
        token: rawToken,
        newPassword: "SomeNewPassword1!",
      });
      expect(res.status).toBe(400);
    } finally {
      await cleanupUser(user.id);
    }
  });

  // ── 8. Already-used token → 400 ───────────────────────────────────────────
  it("already-used token: returns 400", async () => {
    const user = await createTestUser({ suffix: "used-8" });
    const rawToken = crypto.randomBytes(32).toString("hex");
    await insertToken({
      userId: user.id,
      rawToken,
      expiresAt: new Date(Date.now() + 60 * 60 * 1000),
      usedAt: new Date(), // already consumed
    });
    try {
      const res = await post("/api/auth/reset-password", {
        token: rawToken,
        newPassword: "SomeNewPassword1!",
      });
      expect(res.status).toBe(400);
    } finally {
      await cleanupUser(user.id);
    }
  });

  // ── 9. Concurrent claim — single-use guarantee ────────────────────────────
  it("concurrent reset attempts: only one succeeds (token is single-use)", async () => {
    const user = await createTestUser({ suffix: "conc-9" });
    const rawToken = crypto.randomBytes(32).toString("hex");
    await insertToken({
      userId: user.id,
      rawToken,
      expiresAt: new Date(Date.now() + 60 * 60 * 1000),
    });
    try {
      // Fire two concurrent resets with the same token
      const [res1, res2] = await Promise.all([
        post("/api/auth/reset-password", { token: rawToken, newPassword: "Concurrent1111!" }),
        post("/api/auth/reset-password", { token: rawToken, newPassword: "Concurrent2222!" }),
      ]);

      const statuses = [res1.status, res2.status].sort();
      // Exactly one must succeed (200) and one must fail (400)
      expect(statuses).toEqual([200, 400]);
    } finally {
      await cleanupUser(user.id);
    }
  });

  // ── 10. Short password rejected ───────────────────────────────────────────
  it("short password: returns 400 before touching the token", async () => {
    const user = await createTestUser({ suffix: "short-10" });
    const rawToken = crypto.randomBytes(32).toString("hex");
    await insertToken({
      userId: user.id,
      rawToken,
      expiresAt: new Date(Date.now() + 60 * 60 * 1000),
    });
    try {
      const res = await post("/api/auth/reset-password", {
        token: rawToken,
        newPassword: "short",
      });
      expect(res.status).toBe(400);

      // Token must still be unused
      const tokens = await db
        .select()
        .from(schema.passwordResetTokens)
        .where(eq(schema.passwordResetTokens.userId, user.id));
      expect(tokens[0].usedAt).toBeNull();
    } finally {
      await cleanupUser(user.id);
    }
  });

  // ── Admin: POST /api/admin/users accepts authProvider ─────────────────────
  it("admin create user: authProvider is persisted and returned", async () => {
    const session = await getAdminSession();
    const suffix = Date.now();

    // Fetch a role id
    const rolesRes = await adminGet("/api/admin/roles", session);
    const roles = await rolesRes.json();
    const roleId = roles[0]?.id;
    expect(roleId).toBeTruthy();

    const createRes = await adminPost("/api/admin/users", {
      name: `SSO Provision ${suffix}`,
      email: `sso-provision-${suffix}@example.com`,
      password: "TemporaryPass1!",
      roleId,
      authProvider: "entra_sso",
    }, session);
    expect(createRes.status).toBe(200);
    const created = await createRes.json();
    expect(created.authProvider).toBe("entra_sso");

    // Cleanup
    await cleanupUser(created.id);
  });

  // ── Admin: invalid authProvider value rejected ─────────────────────────────
  it("admin PATCH: invalid authProvider value is rejected with 400", async () => {
    const session = await getAdminSession();
    const user = await createTestUser({ suffix: "bad-provider" });
    try {
      const res = await adminPatch(
        `/api/admin/users/${user.id}`,
        { authProvider: "ldap" },
        session,
      );
      expect(res.status).toBe(400);
    } finally {
      await cleanupUser(user.id);
    }
  });
});
