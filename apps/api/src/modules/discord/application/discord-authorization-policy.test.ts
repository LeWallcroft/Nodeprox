import { describe, expect, it } from "vitest";
import {
  hasDiscordCapability,
  projectDiscordAuthorizedRole,
} from "./discord-authorization-policy.js";

describe("Discord authorization read model", () => {
  it("maps configured role flags to stable bot capabilities without storage fields", () => {
    expect(
      projectDiscordAuthorizedRole({
        roleId: "issuer",
        canIssueSeriesGrants: true,
        canInvalidateSeriesGrants: true,
        canConfigureBot: true,
      }),
    ).toEqual({
      roleId: "issuer",
      capabilities: [
        "series_grant.issue",
        "series_grant.invalidate",
        "bot.configure",
      ],
    });
  });

  it("fails closed when a role does not grant the requested capability", () => {
    const roles = [
      projectDiscordAuthorizedRole({
        roleId: "invalidator",
        canIssueSeriesGrants: false,
        canInvalidateSeriesGrants: true,
        canConfigureBot: false,
      }),
    ];
    expect(
      hasDiscordCapability(["invalidator"], roles, "series_grant.issue"),
    ).toBe(false);
    expect(
      hasDiscordCapability(["invalidator"], roles, "series_grant.invalidate"),
    ).toBe(true);
    expect(hasDiscordCapability([], roles, "series_grant.invalidate")).toBe(
      false,
    );
  });
});
