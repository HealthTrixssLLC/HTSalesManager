/**
 * Integration tests for opportunity and activity creation forms.
 *
 * These tests verify that the POST /api/opportunities and POST /api/activities
 * endpoints accept valid payloads (including required fields like closeDate)
 * and return successful responses. This prevents regressions from the
 * organizationId optional fix in insertOpportunitySchema and insertActivitySchema.
 *
 * Run with: npx tsx tests/opportunity-activity-creation.test.ts
 */

const BASE_URL = process.env.TEST_BASE_URL || "http://localhost:5000";

function assert(condition: boolean, message: string): void {
  if (!condition) {
    console.error(`  FAIL: ${message}`);
    process.exitCode = 1;
  } else {
    console.log(`  PASS: ${message}`);
  }
}

function extractCookies(headers: Headers): string {
  const cookies: string[] = [];
  headers.forEach((value, key) => {
    if (key.toLowerCase() === "set-cookie") {
      const nameValue = value.split(";")[0];
      cookies.push(nameValue);
    }
  });
  return cookies.join("; ");
}

async function getSession(): Promise<{ cookie: string; csrfToken: string }> {
  const csrfRes = await fetch(`${BASE_URL}/api/csrf-token`);
  assert(csrfRes.ok, `GET /api/csrf-token succeeds (status ${csrfRes.status})`);

  const csrfCookies = extractCookies(csrfRes.headers);
  const { csrfToken } = (await csrfRes.json()) as { csrfToken: string };
  assert(!!csrfToken, "CSRF token is present in response");

  const loginRes = await fetch(`${BASE_URL}/api/login`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Cookie: csrfCookies,
      "X-CSRF-Token": csrfToken,
    },
    body: JSON.stringify({ email: "admin@test.com", password: "admin123" }),
  });

  assert(loginRes.ok, `Login request succeeds (status ${loginRes.status})`);

  const loginCookies = extractCookies(loginRes.headers);
  const allCookies = [csrfCookies, loginCookies].filter(Boolean).join("; ");

  return { cookie: allCookies, csrfToken };
}

async function getOrCreateAccount(cookie: string, csrfToken: string): Promise<string> {
  const res = await fetch(`${BASE_URL}/api/accounts?limit=1`, {
    headers: { Cookie: cookie },
  });
  assert(res.ok, `GET /api/accounts succeeds (status ${res.status})`);

  const accounts = (await res.json()) as any[];
  if (accounts.length > 0) {
    return accounts[0].id;
  }

  const createRes = await fetch(`${BASE_URL}/api/accounts`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Cookie: cookie,
      "X-CSRF-Token": csrfToken,
    },
    body: JSON.stringify({ name: "E2E Test Account" }),
  });
  assert(createRes.ok, `POST /api/accounts succeeds (status ${createRes.status})`);
  const account = await createRes.json();
  return account.id;
}

async function testOpportunityCreation(cookie: string, csrfToken: string): Promise<void> {
  console.log("\n--- Test: Opportunity Creation ---");

  const accountId = await getOrCreateAccount(cookie, csrfToken);
  assert(!!accountId, `Account ID is available: ${accountId}`);

  const uniqueName = `E2E Test Opportunity ${Date.now()}`;
  const payload = {
    id: "",
    name: uniqueName,
    accountId,
    closeDate: "2025-12-31",
    stage: "prospecting",
  };

  const res = await fetch(`${BASE_URL}/api/opportunities`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Cookie: cookie,
      "X-CSRF-Token": csrfToken,
    },
    body: JSON.stringify(payload),
  });

  const body = await res.json() as any;

  assert(res.ok, `POST /api/opportunities returns 2xx (status ${res.status})`);
  assert(body.id !== undefined, `Response includes opportunity id: ${body.id}`);
  assert(body.name === uniqueName, `Response name matches submitted name`);
  assert(body.accountId === accountId, `Response accountId matches submitted accountId`);
  assert(
    body.closeDate !== null && body.closeDate !== undefined,
    `Response includes closeDate: ${body.closeDate}`
  );
}

async function testActivityCreation(cookie: string, csrfToken: string): Promise<void> {
  console.log("\n--- Test: Activity Creation ---");

  const accountId = await getOrCreateAccount(cookie, csrfToken);
  assert(!!accountId, `Account ID is available for activity association: ${accountId}`);

  const usersRes = await fetch(`${BASE_URL}/api/users`, {
    headers: { Cookie: cookie },
  });
  assert(usersRes.ok, `GET /api/users succeeds (status ${usersRes.status})`);
  const users = (await usersRes.json()) as any[];
  assert(users.length > 0, `At least one user exists for owner selection`);
  const ownerId = users[0].id;

  const uniqueSubject = `E2E Test Activity ${Date.now()}`;
  const payload = {
    type: "call",
    subject: uniqueSubject,
    status: "pending",
    priority: "medium",
    ownerId,
    relatedType: "Account",
    relatedId: accountId,
  };

  const res = await fetch(`${BASE_URL}/api/activities`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Cookie: cookie,
      "X-CSRF-Token": csrfToken,
    },
    body: JSON.stringify(payload),
  });

  const body = await res.json() as any;

  assert(res.ok, `POST /api/activities returns 2xx (status ${res.status})`);
  assert(body.id !== undefined, `Response includes activity id: ${body.id}`);
  assert(body.subject === uniqueSubject, `Response subject matches submitted subject`);
  assert(body.type === "call", `Response type is "call"`);
  assert(body.status === "pending", `Response status is "pending"`);
  assert(body.ownerId === ownerId, `Response ownerId matches submitted ownerId`);
}

async function run(): Promise<void> {
  console.log("=== Opportunity and Activity Creation Integration Tests ===");
  console.log(`Target: ${BASE_URL}`);

  const { cookie, csrfToken } = await getSession();

  await testOpportunityCreation(cookie, csrfToken);
  await testActivityCreation(cookie, csrfToken);

  const exitCode = process.exitCode ?? 0;
  console.log(
    exitCode === 0
      ? "\n=== All tests passed ==="
      : "\n=== Some tests FAILED — see FAIL lines above ==="
  );
}

run().catch((err) => {
  console.error("Unexpected error:", err);
  process.exit(1);
});
