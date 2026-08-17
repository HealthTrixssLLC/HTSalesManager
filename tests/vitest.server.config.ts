// Vitest config for server-side integration tests (run with: npx vitest run --config tests/vitest.server.config.ts)
import { defineConfig } from "vitest/config";
import path from "path";

export default defineConfig({
  test: {
    environment: "node",
    include: ["tests/**/*.test.ts"],
    exclude: [
      "node_modules", ".cache", "dist",
      // Plain tsx script with its own workflow (test-opportunity-activity-creation);
      // it has no vitest suite, so vitest must not collect it.
      "tests/opportunity-activity-creation.test.ts",
    ],
    testTimeout: 60000,
    hookTimeout: 60000,
    // Integration tests share one dev server and database; running files in
    // parallel causes API-key bcrypt scans and auth rate limits to compound,
    // producing flaky timeouts. Run test files sequentially.
    fileParallelism: false,
  },
  resolve: {
    alias: {
      "@shared": path.resolve(__dirname, "..", "shared"),
    },
  },
});
