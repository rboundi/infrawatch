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
