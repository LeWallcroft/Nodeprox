import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: ["apps/**/*.test.ts", "tests/**/*.test.ts"],
    passWithNoTests: false,
  },
});
