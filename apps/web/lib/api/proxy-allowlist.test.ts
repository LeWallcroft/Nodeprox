import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { PROXY_ROUTE_RULES, isAllowedProxyRoute } from "./proxy-allowlist.js";

describe("same-origin proxy allowlist", () => {
  it("keeps every declared rule method-specific", () => {
    expect(PROXY_ROUTE_RULES).not.toHaveLength(0);
    const routes: readonly [string, readonly string[]][] = [
      ["health", ["GET"]],
      ["overview", ["GET"]],
      ["auth/login", ["POST"]],
      ["auth/session", ["GET"]],
      ["auth/password-reset/request", ["POST"]],
      ["me/profile", ["GET", "PATCH"]],
      ["me/sessions/id", ["DELETE"]],
      ["me/notifications/id/read", ["PATCH"]],
      ["admin/users", ["GET"]],
      ["admin/users/id", ["PATCH"]],
      ["admin/settings", ["GET", "PATCH"]],
      ["admin/series-creation-grants/id/invalidate", ["POST"]],
      ["series", ["GET", "POST"]],
      ["series/id", ["GET", "PATCH", "DELETE"]],
      ["series/id/responsible", ["PUT"]],
      ["series/id/import-batches/batch/items/item/retry", ["POST"]],
      ["chapters", ["GET"]],
      ["chapters/id", ["GET", "PATCH", "DELETE"]],
      ["chapters/id/permissions", ["GET", "POST"]],
      ["chapters/id/uploads/upload/complete", ["POST"]],
      ["chapters/id/images/image/replacements/replacement/complete", ["POST"]],
      ["images/id/content", ["GET"]],
      ["public/chapters/id", ["GET"]],
    ];
    for (const [path, methods] of routes) {
      for (const method of methods)
        expect(isAllowedProxyRoute(path, method)).toBe(true);
      expect(isAllowedProxyRoute(path, "OPTIONS")).toBe(false);
    }
    expect(isAllowedProxyRoute("series/id", "POST")).toBe(false);
  });

  it("denies unknown, near-miss, and prefix-collision paths", () => {
    for (const path of [
      "admin/usersX",
      "seriesXYZ",
      "public/chapters/chapter/extra",
      "unknown/path",
      "chapters/id/permissions-extra",
      "me/sessions/id/extra",
      "admin/users/id/series-responsibilities-extra",
    ])
      expect(isAllowedProxyRoute(path, "GET")).toBe(false);
  });

  it("is consumed by the route handler rather than a second inline matrix", () => {
    const route = readFileSync(
      resolve(process.cwd(), "apps/web/app/api/[...path]/route.ts"),
      "utf8",
    );
    expect(route).toContain("isAllowedProxyRoute");
    expect(route).not.toContain("function isAllowedRoute");
  });

  it("permits only the explicit StorageProfile administration routes and methods", () => {
    const allowed: readonly [string, readonly string[]][] = [
      ["admin/storage/profiles", ["GET", "POST"]],
      ["admin/storage/profiles/id", ["GET", "PATCH"]],
      ["admin/storage/profiles/id/readiness", ["GET"]],
      ["admin/storage/profiles/id/credentials", ["POST"]],
      ["admin/storage/profiles/id/b2/provision", ["POST"]],
      ["admin/storage/profiles/id/b2/recheck", ["POST"]],
      ["admin/storage/profiles/id/browser-probe/start", ["POST"]],
      ["admin/storage/profiles/id/browser-probe/complete", ["POST"]],
      ["admin/storage/profiles/id/cloudflare/status", ["GET"]],
      ["admin/storage/profiles/id/cloudflare/provision", ["POST"]],
      ["admin/storage/profiles/id/cloudflare/recheck", ["POST"]],
      ["admin/storage/profiles/id/activate", ["POST"]],
    ];
    for (const [path, methods] of allowed) {
      for (const method of methods)
        expect(isAllowedProxyRoute(path, method)).toBe(true);
      expect(isAllowedProxyRoute(path, "DELETE")).toBe(false);
    }
    for (const path of [
      "admin/storage/profiles/id/delete",
      "admin/storage/profiles/id/cloudflare/purge",
      "admin/storage/profiles/id/b2/cors",
      "admin/storage/profiles/id/readiness-extra",
      "admin/storage/profilesXYZ",
    ])
      expect(isAllowedProxyRoute(path, "POST")).toBe(false);
  });
});
