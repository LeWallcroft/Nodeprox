import { GatewayIntentBits } from "discord.js";
import { describe, expect, it } from "vitest";
import { createDiscordClient } from "./client.js";

describe("Discord gateway intents", () => {
  it("requests only Guilds when profile events are disabled", () => {
    const client = createDiscordClient();
    expect(client.options.intents.bitfield).toBe(GatewayIntentBits.Guilds);
    client.destroy();
  });

  it("requests GuildMembers only when profile events are enabled", () => {
    const client = createDiscordClient({ profileEventsEnabled: true });
    expect(client.options.intents.has(GatewayIntentBits.Guilds)).toBe(true);
    expect(client.options.intents.has(GatewayIntentBits.GuildMembers)).toBe(
      true,
    );
    client.destroy();
  });
});
