export function isAllowedControlChannel(
  interaction: { channelId: string | null },
  channelId: string,
) {
  return interaction.channelId === channelId;
}
