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

  it("grants Gestor Series edit and assignment management but not deletion", () => {
    expect(ROLE_PERMISSIONS.admin).toContain(PERMISSIONS.SERIES_DELETE);
    expect(ROLE_PERMISSIONS.gestor).toContain(PERMISSIONS.SERIES_EDIT);
    expect(ROLE_PERMISSIONS.gestor).toContain(
      PERMISSIONS.SERIES_ASSIGNMENT_MANAGE,
    );
    expect(ROLE_PERMISSIONS.gestor).not.toContain(PERMISSIONS.SERIES_DELETE);
  });

  it("allows Uploader Series edit permission while leaving deletion unavailable", () => {
    expect(ROLE_PERMISSIONS.uploader).toContain(PERMISSIONS.SERIES_EDIT);
    expect(ROLE_PERMISSIONS.uploader).not.toContain(PERMISSIONS.SERIES_DELETE);
  });
});
