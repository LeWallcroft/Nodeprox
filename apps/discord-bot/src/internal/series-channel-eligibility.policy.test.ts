import { ChannelType, PermissionFlagsBits } from "discord.js";
import { describe, expect, it } from "vitest";
import {
  canViewSeriesChannel,
  evaluateSeriesChannelEligibility,
} from "./series-channel-eligibility.policy.js";

const guildId = "12345678901234567";
const controlChannelId = "22345678901234567";

function evaluate(
  input: Partial<
    Parameters<typeof evaluateSeriesChannelEligibility>[0]["channel"]
  > = {},
) {
  return evaluateSeriesChannelEligibility({
    guildId,
    controlChannelId,
    channel: {
      id: "32345678901234567",
      guildId,
      name: "series-manga",
      type: ChannelType.GuildText,
      viewable: true,
      ...input,
    },
  });
}

describe("series channel eligibility", () => {
  it("accepts only visible standard text channels outside the control channel", () => {
    expect(evaluate()).toEqual({
      valid: true,
      channel: { id: "32345678901234567", name: "series-manga" },
    });
  });

  it.each([
    ["category", ChannelType.GuildCategory],
    ["voice", ChannelType.GuildVoice],
    ["stage", ChannelType.GuildStageVoice],
    ["forum", ChannelType.GuildForum],
    ["thread", ChannelType.PublicThread],
  ])("rejects %s channels", (_label, type) => {
    expect(evaluate({ type })).toEqual({
      valid: false,
      reason: "unsupported_type",
    });
  });

  it("rejects unavailable, foreign, control, and inaccessible channels", () => {
    expect(
      evaluateSeriesChannelEligibility({
        guildId,
        controlChannelId,
        channel: null,
      }),
    ).toEqual({ valid: false, reason: "not_found" });
    expect(evaluate({ guildId: "42345678901234567" })).toEqual({
      valid: false,
      reason: "wrong_guild",
    });
    expect(evaluate({ id: controlChannelId })).toEqual({
      valid: false,
      reason: "control_channel",
    });
    expect(evaluate({ viewable: false })).toEqual({
      valid: false,
      reason: "not_visible",
    });
  });

  it("uses only ViewChannel permission", () => {
    expect(
      canViewSeriesChannel({
        has: (permission) => permission === PermissionFlagsBits.ViewChannel,
      }),
    ).toBe(true);
    expect(canViewSeriesChannel({ has: () => false })).toBe(false);
  });
});
