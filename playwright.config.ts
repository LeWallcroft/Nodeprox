import { defineConfig } from "@playwright/test";

const e2eWebOrigin = "http://127.0.0.1:3100";
const e2eApiOrigin = "http://127.0.0.1:3101";
process.env.NODEPROX_API_URL = e2eApiOrigin;

export default defineConfig({
  testDir: "./tests/e2e",
  workers: 1,
  use: {
    baseURL: e2eWebOrigin,
    trace: "on-first-retry",
  },
  webServer: [
    {
      command: "pnpm --filter @nodeprox/web exec next dev --port 3100",
      url: `${e2eWebOrigin}/login`,
      reuseExistingServer: false,
    },
    ...(process.env.E2E_EXTERNAL_BACKEND
      ? []
      : [
          {
            command: "pnpm tsx scripts/e2e-backend.ts",
            url: `${e2eApiOrigin}/health`,
            reuseExistingServer: false,
            timeout: 120_000,
          },
        ]),
  ],
});
