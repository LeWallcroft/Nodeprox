import { describe, expect, it } from "vitest";
import { navigationConfig } from "./config";
import { isNavigationItemActive } from "../routing/is-active";

describe("M1 navigation contract", () => {
  it("keeps navigation declarative and typed", () => {
    expect(navigationConfig.map((item) => item.id)).toEqual([
      "overview",
      "series",
      "uploads",
      "links",
      "admin",
    ]);
    expect(
      navigationConfig.find((item) => item.id === "admin")?.capabilityKey,
    ).toBe("admin.system.manage");
  });

  it("resolves active routes without granting capabilities", () => {
    expect(isNavigationItemActive("/series/one", "/series")).toBe(true);
    expect(isNavigationItemActive("/series", "/")).toBe(false);
    expect(isNavigationItemActive("/", "/")).toBe(true);
  });
});
