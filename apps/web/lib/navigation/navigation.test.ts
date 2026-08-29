import { describe, expect, it } from "vitest";
import { navigationConfig } from "./config";
import { getVisibleNavigation } from "./policy";
import { isNavigationItemActive } from "../routing/is-active";

describe("M1 navigation contract", () => {
  it("keeps navigation declarative and typed", () => {
    expect(navigationConfig.map((item) => item.id)).toEqual([
      "overview",
      "audit",
      "series",
      "chapters",
      "settings",
      "users",
    ]);
    expect(
      navigationConfig.find((item) => item.id === "settings")?.capabilityKey,
    ).toBe("admin.system.manage");
    expect(
      navigationConfig.find((item) => item.id === "series")?.capabilityKey,
    ).toBe("series.read");
    expect(navigationConfig.every((item) => item.icon !== undefined)).toBe(
      true,
    );
  });

  it("keeps global and Series-scoped Chapter paths distinct", () => {
    expect(isNavigationItemActive("/series/one", "/series")).toBe(true);
    expect(isNavigationItemActive("/series/one/chapters", "/series")).toBe(
      true,
    );
    expect(
      isNavigationItemActive("/series/one/chapters/two/images", "/series"),
    ).toBe(true);
    expect(isNavigationItemActive("/chapters", "/chapters")).toBe(true);
    expect(isNavigationItemActive("/series/one/chapters", "/chapters")).toBe(
      false,
    );
    expect(isNavigationItemActive("/series", "/")).toBe(false);
    expect(isNavigationItemActive("/", "/")).toBe(true);
  });

  it("keeps administrative siblings mutually exclusive", () => {
    expect(isNavigationItemActive("/admin/users", "/admin/users")).toBe(true);
    expect(isNavigationItemActive("/admin/users", "/admin")).toBe(false);
    expect(isNavigationItemActive("/admin/users", "/admin/audit")).toBe(false);
    expect(isNavigationItemActive("/admin/audit", "/admin/audit")).toBe(true);
    expect(isNavigationItemActive("/admin/audit", "/admin/users")).toBe(false);
    expect(isNavigationItemActive("/admin", "/admin")).toBe(true);
  });

  it("filters global navigation only from session capabilities", () => {
    const sections = getVisibleNavigation([
      "series.read",
      "chapters.read",
      "images.upload",
    ]);
    expect(sections.map((section) => section.id)).toEqual([
      "principal",
      "content",
    ]);
    expect(sections.at(-1)?.items.map((item) => item.id)).toEqual([
      "series",
      "chapters",
    ]);
    expect(
      getVisibleNavigation([
        "series.read",
        "admin.users.manage",
        "admin.system.manage",
      ])
        .flatMap((section) => section.items)
        .map((item) => item.id),
    ).toEqual(["overview", "series", "users", "audit", "settings"]);
  });

  it("keeps the supported sidebar IA free of duplicate or deferred items", () => {
    const sections = getVisibleNavigation([
      "series.read",
      "chapters.read",
      "admin.users.manage",
      "admin.system.manage",
    ]);
    expect(sections.map((section) => section.label)).toEqual([
      "Principal",
      "Contenido",
      "Administración",
    ]);
    expect(
      sections.flatMap((section) => section.items.map((item) => item.id)),
    ).toEqual(["overview", "series", "chapters", "users", "audit", "settings"]);
  });
});
