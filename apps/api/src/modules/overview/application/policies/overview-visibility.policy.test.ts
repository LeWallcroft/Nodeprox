import { describe, expect, it } from "vitest";
import { PERMISSIONS } from "../../../authorization/domain/permissions.js";
import { resolveOverviewVisibility } from "./overview-visibility.policy.js";

describe("resolveOverviewVisibility", () => {
  it("projects global data only from the corresponding backend capabilities", () => {
    expect(
      resolveOverviewVisibility([
        PERMISSIONS.ADMIN_USERS_MANAGE,
        PERMISSIONS.ADMIN_SYSTEM_MANAGE,
      ]),
    ).toEqual({
      canViewActiveUsers: true,
      canViewRecentActivity: true,
    });
  });

  it("hides global user and audit data without administrative capabilities", () => {
    expect(resolveOverviewVisibility([PERMISSIONS.SERIES_READ])).toEqual({
      canViewActiveUsers: false,
      canViewRecentActivity: false,
    });
  });
});
