import { test as setup } from "@playwright/test";
import * as path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export const AUTH_FILE = path.join(__dirname, "..", ".auth-state.json");

setup("Authenticate as admin@test.com", async ({ page }) => {
  await page.goto("/auth");
  await page.getByTestId("input-login-email").fill("admin@test.com");
  await page.getByTestId("input-login-password").fill("admin123");
  await page.getByTestId("button-login").click();
  await page.waitForURL("/", { timeout: 15000 });
  await page.context().storageState({ path: AUTH_FILE });
});
