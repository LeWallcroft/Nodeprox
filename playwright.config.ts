import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./tests/e2e",
  workers: 1,
  use: {
    baseURL: "http://127.0.0.1:3000",
    trace: "on-first-retry",
  },
  webServer: [
    {
      command: "pnpm --filter @nodeprox/web dev",
      url: "http://127.0.0.1:3000/login",
      reuseExistingServer: true,
    },
    ...(process.env.E2E_EXTERNAL_BACKEND
      ? []
      : [
          {
            command: "pnpm tsx scripts/e2e-backend.ts",
            url: "http://127.0.0.1:3001/health",
            reuseExistingServer: false,
            timeout: 120_000,
          },
        ]),
  ],
});
