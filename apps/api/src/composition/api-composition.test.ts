import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { buildApp } from "../app.js";
import { createApiDependencies } from "./create-api-dependencies.js";

describe("API composition", () => {
  it("constructs explicit dependencies outside buildApp and keeps the health-only app available", async () => {
    const dependencies = createApiDependencies({
      environment: {
        APP_PUBLIC_URL: "https://example.test",
        PASSWORD_RESET_TTL_MINUTES: "17",
      },
      storage: { provider: "filesystem", uploadMaxSizeBytes: 1024 },
    });
    expect(dependencies.account).toEqual({
      publicUrl: "https://example.test",
      resetTtlMinutes: 17,
    });
    expect(dependencies.storageConfig.provider).toBe("filesystem");
    const app = buildApp({ logger: false }, dependencies);
    await app.ready();
    await app.close();
  });

  it("keeps provider selection and environment reads out of the route composition", () => {
    const appSource = readFileSync(
      resolve(process.cwd(), "apps/api/src/app.ts"),
      "utf8",
    );
    expect(appSource).not.toContain("process.env");
    expect(appSource).not.toContain("new B2Storage");
    expect(appSource).not.toContain("new FilesystemStorage");
    expect(appSource).not.toContain("new BrevoTransactionalEmail");
  });
});
