import { describe, expect, it } from "vitest";
import { normalizeDiscordAuthorizedRoles } from "./normalize";

describe("normalizeDiscordAuthorizedRoles", () => {
  it("keeps capabilities independent and removes duplicate role data", () => {
    expect(
      normalizeDiscordAuthorizedRoles([
        {
          roleId: " 100000000000000001 ",
          capabilities: ["series_grant.issue"],
        },
        { roleId: "100000000000000001", capabilities: ["bot.configure"] },
        {
          roleId: "200000000000000002",
          capabilities: ["series_grant.invalidate"],
        },
      ]),
    ).toEqual([
      {
        roleId: "100000000000000001",
        capabilities: ["bot.configure", "series_grant.issue"],
      },
      {
        roleId: "200000000000000002",
        capabilities: ["series_grant.invalidate"],
      },
    ]);
  });

  it("does not infer bot configuration from series authorization", () => {
    expect(
      normalizeDiscordAuthorizedRoles([
        { roleId: "100000000000000001", capabilities: ["series_grant.issue"] },
      ]),
    ).toEqual([
      { roleId: "100000000000000001", capabilities: ["series_grant.issue"] },
    ]);
  });
});
