import { describe, expect, it } from "vitest";
import { isAllowedControlChannel } from "./control-channel.guard.js";
import { isAllowedGuild } from "./guild.guard.js";

describe("Discord command guards", () => {
  it("accepts the configured guild and control channel", () => {
    expect(isAllowedGuild({ guildId: "guild" } as never, "guild")).toBe(true);
    expect(
      isAllowedControlChannel({ channelId: "channel" } as never, "channel"),
    ).toBe(true);
  });

  it("rejects other guilds and channels", () => {
    expect(isAllowedGuild({ guildId: "other" } as never, "guild")).toBe(false);
    expect(
      isAllowedControlChannel({ channelId: "other" } as never, "channel"),
    ).toBe(false);
  });
});
