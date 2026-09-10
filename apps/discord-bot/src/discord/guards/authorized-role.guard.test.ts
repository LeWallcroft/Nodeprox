import { describe, expect, it } from "vitest";
import {
  getInteractionRoleIds,
  hasDiscordCapability,
} from "./authorized-role.guard.js";

describe("Discord authorized role guard", () => {
  const roles = [
    { roleId: "issuer", capabilities: ["series_grant.issue"] as const },
    {
      roleId: "invalidator",
      capabilities: ["series_grant.invalidate"] as const,
    },
  ];

  it("allows only a configured matching issue role", () => {
    expect(hasDiscordCapability(["issuer"], roles, "series_grant.issue")).toBe(
      true,
    );
    expect(
      hasDiscordCapability(["invalidator"], roles, "series_grant.issue"),
    ).toBe(false);
    expect(hasDiscordCapability(["unknown"], roles, "series_grant.issue")).toBe(
      false,
    );
    expect(hasDiscordCapability([], roles, "series_grant.issue")).toBe(false);
  });

  it("extracts role IDs from raw guild interaction roles without fetching members", () => {
    expect(
      getInteractionRoleIds({ member: { roles: ["issuer", "issuer"] } }),
    ).toEqual(["issuer"]);
    expect(getInteractionRoleIds({ member: null })).toEqual([]);
  });
});
