import { ChannelType, PermissionFlagsBits } from "discord.js";

export type SeriesChannelRejectionReason =
  | "not_found"
  | "wrong_guild"
  | "unsupported_type"
  | "not_visible"
  | "control_channel";

export type SeriesChannelCandidate = {
  id: string;
  guildId: string | null;
  name: string;
  type: ChannelType;
  viewable: boolean;
};

export type SeriesChannelEligibility =
  | { valid: true; channel: { id: string; name: string } }
  | { valid: false; reason: SeriesChannelRejectionReason };

/**
 * Keeps Discord-specific channel eligibility at the adapter boundary. The API
 * receives only the minimal safe projection, never Discord.js channel objects.
 */
export function evaluateSeriesChannelEligibility(input: {
  channel: SeriesChannelCandidate | null;
  guildId: string;
  controlChannelId: string;
}): SeriesChannelEligibility {
  const { channel } = input;
  if (!channel) return { valid: false, reason: "not_found" };
  if (channel.guildId !== input.guildId)
    return { valid: false, reason: "wrong_guild" };
  if (channel.id === input.controlChannelId)
    return { valid: false, reason: "control_channel" };
  if (channel.type !== ChannelType.GuildText)
    return { valid: false, reason: "unsupported_type" };
  if (!channel.viewable) return { valid: false, reason: "not_visible" };
  return { valid: true, channel: { id: channel.id, name: channel.name } };
}

export function canViewSeriesChannel(
  permissions: { has(permission: bigint): boolean } | null | undefined,
) {
  return permissions?.has(PermissionFlagsBits.ViewChannel) ?? false;
}
