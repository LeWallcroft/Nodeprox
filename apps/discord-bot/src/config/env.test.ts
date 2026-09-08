import { describe, expect, it } from "vitest";
import { loadDiscordBotConfig } from "./env.js";

const valid = {
  DISCORD_APPLICATION_ID: "app",
  DISCORD_BOT_TOKEN: "bot-token",
  DISCORD_GUILD_ID: "guild",
  DISCORD_CONTROL_CHANNEL_ID: "channel",
  NODEPROX_INTERNAL_API_URL: "http://127.0.0.1:3001",
  DISCORD_BOT_INTERNAL_TOKEN: "internal-token",
};

describe("Discord bot configuration", () => {
  it.each([
    "DISCORD_BOT_TOKEN",
    "DISCORD_GUILD_ID",
    "DISCORD_CONTROL_CHANNEL_ID",
  ])("fails fast when %s is missing", (key) => {
    const env = { ...valid, [key]: undefined };
    expect(() => loadDiscordBotConfig(env)).toThrow(
      "Discord bot configuration is invalid.",
    );
  });
});
