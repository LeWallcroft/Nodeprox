import { defineConfig } from "vitest/config";

export default defineConfig({
  esbuild: {
    jsx: "automatic",
  },
  test: {
    environment: "node",
    include: [
      "apps/**/*.test.{ts,tsx}",
      "tests/unit/**/*.test.ts",
      "tests/security/**/*.test.ts",
    ],
    passWithNoTests: false,
  },
});
