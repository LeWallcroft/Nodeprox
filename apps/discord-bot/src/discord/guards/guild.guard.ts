import type { ChatInputCommandInteraction } from "discord.js";

export function isAllowedGuild(
  interaction: Pick<ChatInputCommandInteraction, "guildId">,
  guildId: string,
) {
  return interaction.guildId === guildId;
}
