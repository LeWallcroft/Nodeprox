import { z } from "zod";

const schema = z.object({
  DISCORD_APPLICATION_ID: z.string().trim().min(1),
  DISCORD_BOT_TOKEN: z.string().trim().min(1),
  DISCORD_GUILD_ID: z.string().trim().min(1),
  DISCORD_CONTROL_CHANNEL_ID: z.string().trim().min(1),
  NODEPROX_INTERNAL_API_URL: z.url(),
  DISCORD_BOT_INTERNAL_TOKEN: z.string().trim().min(1),
  LOG_LEVEL: z
    .enum(["fatal", "error", "warn", "info", "debug", "trace", "silent"])
    .default("info"),
});

export type DiscordBotConfig = z.infer<typeof schema>;

export function loadDiscordBotConfig(
  env: Readonly<Record<string, string | undefined>> = process.env,
): DiscordBotConfig {
  const parsed = schema.safeParse(env);
  if (!parsed.success) throw new Error("Discord bot configuration is invalid.");
  return parsed.data;
}
