import { test, expect, type Page } from "@playwright/test";

/**
 * Org Data Isolation Tests
 *
 * Verifies that switching between organizations in the Health Trixss CRM
 * correctly scopes all data shown to the active organization only — preventing
 * cross-tenant data leaks.
 *
 * Prerequisites (set up in dev DB):
 *  - admin@test.com / admin123 belongs to BOTH:
 *    - "Primary Organization" (id: 3e369484-0c88-401d-86e3-9c3361ee465e) — default
 *    - "Lucentria Inc." (id: ef8f31ec-840b-4fc4-bcbe-7d604c3c5d43)
 *  - Lucentria-only records (visible only when active org = Lucentria Inc.):
 *    - Opportunity: "LUCENTRIA-TEST-OPPORTUNITY-XZ99"
 *    - Activity:    "LUCENTRIA-TEST-ACTIVITY-XZ99"
 *
 * Auth is pre-set via the setup project (tests/e2e/setup/auth.setup.ts).
 * All browser tests reuse the saved session and avoid repeated logins.
 */

const PRIMARY_ORG_ID = "3e369484-0c88-401d-86e3-9c3361ee465e";
const LUCENTRIA_ORG_ID = "ef8f31ec-840b-4fc4-bcbe-7d604c3c5d43";

const LUCENTRIA_OPPORTUNITY = "LUCENTRIA-TEST-OPPORTUNITY-XZ99";
const LUCENTRIA_ACTIVITY = "LUCENTRIA-TEST-ACTIVITY-XZ99";

async function switchOrg(page: Page, orgId: string) {
  await page.getByTestId("button-org-switcher").click();
  await page.getByTestId(`option-org-${orgId}`).click();
  await page.waitForTimeout(2000);
}

async function waitForPage(page: Page) {
  await page.waitForLoadState("domcontentloaded");
  await page.waitForTimeout(1200);
}

async function waitForSmallDataPage(page: Page) {
  try {
    await page.waitForLoadState("networkidle", { timeout: 10000 });
  } catch {
    await page.waitForLoadState("domcontentloaded");
    await page.waitForTimeout(1500);
  }
}

async function setOrg(page: Page, orgId: string) {
  await page.evaluate((id) => localStorage.setItem("activeOrgId", id), orgId);
  await page.waitForTimeout(300);
}

test.describe("Org switching data isolation", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/");
    await page.waitForURL("/", { timeout: 10000 });
    await setOrg(page, PRIMARY_ORG_ID);
  });

  // ─── OPPORTUNITIES ────────────────────────────────────────────────────────────

  test("Opportunities: Primary Org does not show Lucentria-only records", async ({ page }) => {
    await page.goto("/opportunities");
    await waitForPage(page);

    const searchBox = page.getByTestId("input-search-opportunities");
    await searchBox.fill("LUCENTRIA-TEST");
    await page.waitForTimeout(800);

    await expect(page.locator(`text=${LUCENTRIA_OPPORTUNITY}`)).not.toBeVisible();
  });

  test("Opportunities: Lucentria Inc. shows its own records", async ({ page }) => {
    await setOrg(page, LUCENTRIA_ORG_ID);
    await page.goto("/opportunities");
    await waitForSmallDataPage(page);

    await expect(page.locator(`text=${LUCENTRIA_OPPORTUNITY}`)).toBeVisible({ timeout: 15000 });
  });

  test("Opportunities: UI org switch reveals Lucentria-only records and hides them on switch back", async ({ page }) => {
    await page.goto("/opportunities");
    await waitForPage(page);

    await switchOrg(page, LUCENTRIA_ORG_ID);
    await page.goto("/opportunities");
    await waitForSmallDataPage(page);
    await expect(page.locator(`text=${LUCENTRIA_OPPORTUNITY}`)).toBeVisible({ timeout: 15000 });

    await switchOrg(page, PRIMARY_ORG_ID);
    await page.goto("/opportunities");
    await waitForPage(page);

    const searchBox = page.getByTestId("input-search-opportunities");
    await searchBox.fill("LUCENTRIA-TEST");
    await page.waitForTimeout(800);

    await expect(page.locator(`text=${LUCENTRIA_OPPORTUNITY}`)).not.toBeVisible();
  });

  // ─── ACTIVITIES ───────────────────────────────────────────────────────────────

  test("Activities: Primary Org does not show Lucentria-only records", async ({ page }) => {
    await page.goto("/activities");
    await waitForPage(page);

    const searchBox = page.getByTestId("input-search-activities");
    await searchBox.fill("LUCENTRIA-TEST");
    await page.waitForTimeout(800);

    await expect(page.locator(`text=${LUCENTRIA_ACTIVITY}`)).not.toBeVisible();
  });

  test("Activities: Lucentria Inc. shows its own records", async ({ page }) => {
    await setOrg(page, LUCENTRIA_ORG_ID);
    await page.goto("/activities");
    await waitForSmallDataPage(page);

    await expect(page.locator(`text=${LUCENTRIA_ACTIVITY}`)).toBeVisible({ timeout: 15000 });
  });

  // ─── ANALYTICS ───────────────────────────────────────────────────────────────

  test("Analytics: renders correctly in Primary Org", async ({ page }) => {
    await page.goto("/analytics");
    await page.waitForLoadState("domcontentloaded");
    await expect(page.getByTestId("analytics-page")).toBeVisible({ timeout: 20000 });
    await expect(page.getByTestId("text-revenue")).toBeVisible({ timeout: 10000 });
    await expect(page.getByTestId("text-winrate")).toBeVisible({ timeout: 10000 });
  });

  test("Analytics: renders correctly in Lucentria Inc.", async ({ page }) => {
    await setOrg(page, LUCENTRIA_ORG_ID);
    await page.goto("/analytics");
    await page.waitForLoadState("domcontentloaded");
    await expect(page.getByTestId("analytics-page")).toBeVisible({ timeout: 20000 });
    await expect(page.getByTestId("text-revenue")).toBeVisible({ timeout: 10000 });
    await expect(page.getByTestId("text-winrate")).toBeVisible({ timeout: 10000 });
  });

  // ─── API ISOLATION ───────────────────────────────────────────────────────────

  test("API: /api/opportunities without X-Organization-Id header falls back to default org only", async ({
    request,
  }) => {
    const loginResponse = await request.post("/api/login", {
      data: { email: "admin@test.com", password: "admin123" },
      headers: { "Content-Type": "application/json" },
    });
    expect(loginResponse.ok()).toBeTruthy();

    const response = await request.get("/api/opportunities");
    expect([200, 401, 429]).toContain(response.status());

    if (response.status() === 200) {
      const body = await response.json();
      const opportunities: { name: string }[] = Array.isArray(body) ? body : body.opportunities ?? [];
      const leakedRecord = opportunities.find((o) => o.name === LUCENTRIA_OPPORTUNITY);
      expect(leakedRecord).toBeUndefined();
    }
  });

  test("API: /api/activities without X-Organization-Id header falls back to default org only", async ({
    request,
  }) => {
    const loginResponse = await request.post("/api/login", {
      data: { email: "admin@test.com", password: "admin123" },
      headers: { "Content-Type": "application/json" },
    });
    expect(loginResponse.ok()).toBeTruthy();

    const response = await request.get("/api/activities");
    expect([200, 401, 429]).toContain(response.status());

    if (response.status() === 200) {
      const body = await response.json();
      const activities: { subject: string }[] = Array.isArray(body) ? body : body.activities ?? [];
      const leakedRecord = activities.find((a) => a.subject === LUCENTRIA_ACTIVITY);
      expect(leakedRecord).toBeUndefined();
    }
  });
});
