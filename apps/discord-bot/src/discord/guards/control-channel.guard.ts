import type { ChatInputCommandInteraction } from "discord.js";

export function isAllowedControlChannel(
  interaction: Pick<ChatInputCommandInteraction, "channelId">,
  channelId: string,
) {
  return interaction.channelId === channelId;
}
