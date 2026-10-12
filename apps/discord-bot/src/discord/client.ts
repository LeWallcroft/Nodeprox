import { Client, GatewayIntentBits } from "discord.js";

export function createDiscordClient(
  input: { profileEventsEnabled?: boolean } = {},
) {
  return new Client({
    intents: input.profileEventsEnabled
      ? [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMembers]
      : [GatewayIntentBits.Guilds],
  });
}
