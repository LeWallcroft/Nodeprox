import { describe, expect, it } from "vitest";
import { PERMISSIONS, ROLE_PERMISSIONS } from "./permissions.js";

describe("central role permissions", () => {
  it("reserves Discord integration configuration for admins", () => {
    expect(ROLE_PERMISSIONS.admin).toContain(
      PERMISSIONS.DISCORD_INTEGRATION_CONFIGURE,
    );
    expect(ROLE_PERMISSIONS.gestor).not.toContain(
      PERMISSIONS.DISCORD_INTEGRATION_CONFIGURE,
    );
    expect(ROLE_PERMISSIONS.uploader).not.toContain(
      PERMISSIONS.DISCORD_INTEGRATION_CONFIGURE,
    );
  });

  it("preserves unrelated gestor permissions", () => {
    expect(ROLE_PERMISSIONS.gestor).toContain(PERMISSIONS.SERIES_CREATE);
    expect(ROLE_PERMISSIONS.gestor).toContain(PERMISSIONS.IMAGES_UPLOAD);
  });
});
