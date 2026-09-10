export function isAllowedGuild(
  interaction: { guildId: string | null },
  guildId: string,
) {
  return interaction.guildId === guildId;
}
