import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: [
      "packages/server/src/**/*.test.ts",
      "packages/scanner/src/**/*.test.ts",
    ],
    testTimeout: 30_000,
    hookTimeout: 30_000,
    environment: "node",
    env: {
      MASTER_KEY: "test-master-key-for-encryption-do-not-use-in-prod",
      NODE_ENV: "test",
    },
    coverage: {
      provider: "v8",
      include: ["packages/server/src/**/*.ts", "packages/scanner/src/**/*.ts"],
      exclude: [
        "**/*.test.ts",
        "**/__tests__/**",
        "**/types.ts",
        "**/index.ts",
      ],
    },
  },
});
