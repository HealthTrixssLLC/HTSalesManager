import { defineConfig, devices } from "@playwright/test";
import * as path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const CHROMIUM_EXECUTABLE =
  process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH ||
  "/nix/store/zi4f80l169xlmivz8vja8wlphq74qqk0-chromium-125.0.6422.141/bin/chromium";

const CHROMIUM_ARGS = [
  "--no-sandbox",
  "--disable-setuid-sandbox",
  "--disable-dev-shm-usage",
  "--disable-gpu",
];

export default defineConfig({
  testDir: "./tests/e2e",
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: 1,
  workers: 1,
  reporter: "list",
  timeout: 60000,
  use: {
    baseURL: "http://localhost:5000",
    trace: "on-first-retry",
    screenshot: "only-on-failure",
    launchOptions: {
      executablePath: CHROMIUM_EXECUTABLE,
      args: CHROMIUM_ARGS,
    },
  },
  projects: [
    {
      name: "setup",
      testMatch: "**/setup/auth.setup.ts",
      use: {
        launchOptions: {
          executablePath: CHROMIUM_EXECUTABLE,
          args: CHROMIUM_ARGS,
        },
      },
    },
    {
      name: "chromium",
      use: {
        ...devices["Desktop Chrome"],
        storageState: path.join(__dirname, "tests/e2e/.auth-state.json"),
        launchOptions: {
          executablePath: CHROMIUM_EXECUTABLE,
          args: CHROMIUM_ARGS,
        },
      },
      dependencies: ["setup"],
    },
  ],
});
