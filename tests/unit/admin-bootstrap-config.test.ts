import { describe, expect, it } from "vitest";
import { loadAdminBootstrapConfig } from "@nodeprox/config";

describe("admin bootstrap configuration", () => {
  it("requires a valid deployment identity and password", () => {
    expect(() => loadAdminBootstrapConfig({})).toThrow();
    expect(() =>
      loadAdminBootstrapConfig({
        ADMIN_BOOTSTRAP_EMAIL: "invalid",
        ADMIN_BOOTSTRAP_PASSWORD: "secret",
      }),
    ).toThrow();
    expect(() =>
      loadAdminBootstrapConfig({
        ADMIN_BOOTSTRAP_EMAIL: "admin@example.com",
        ADMIN_BOOTSTRAP_PASSWORD: "",
      }),
    ).toThrow();
    expect(
      loadAdminBootstrapConfig({
        ADMIN_BOOTSTRAP_EMAIL: " Admin@Example.com ",
        ADMIN_BOOTSTRAP_PASSWORD: "secret",
      }),
    ).toEqual({
      ADMIN_BOOTSTRAP_EMAIL: "admin@example.com",
      ADMIN_BOOTSTRAP_PASSWORD: "secret",
    });
  });
});
