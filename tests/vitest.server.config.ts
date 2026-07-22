// Vitest config for server-side integration tests (run with: npx vitest run --config tests/vitest.server.config.ts)
import { defineConfig } from "vitest/config";
import path from "path";

export default defineConfig({
  test: {
    environment: "node",
    include: ["tests/**/*.test.ts"],
    exclude: ["node_modules", ".cache", "dist"],
    testTimeout: 30000,
    hookTimeout: 30000,
  },
  resolve: {
    alias: {
      "@shared": path.resolve(__dirname, "..", "shared"),
    },
  },
});
