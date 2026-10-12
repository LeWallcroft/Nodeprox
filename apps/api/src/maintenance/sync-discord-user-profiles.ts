import { loadConfig, loadDiscordProfileSyncConfig } from "@nodeprox/config";
import { createDatabase } from "../../../../database/client.js";
import { DiscordProfileSyncRunner } from "../modules/discord/application/discord-profile-sync.runner.js";
import { SyncDiscordUserProfilesService } from "../modules/discord/application/sync-discord-user-profiles.service.js";
import { DiscordBotUserProfileGateway } from "../modules/discord/infrastructure/discord-bot-user-profile.gateway.js";
import { DrizzleDiscordProfileRepository } from "../modules/discord/infrastructure/persistence/drizzle/discord-profile.repository.js";

const config = loadConfig();
const syncConfig = loadDiscordProfileSyncConfig();
if (!config.DISCORD_BOT_INTERNAL_TOKEN)
  throw new Error("discord-bot-internal-configuration-required");

const connection = createDatabase(config.DATABASE_URL);
const repository = new DrizzleDiscordProfileRepository(connection.db);
const runner = new DiscordProfileSyncRunner(
  new SyncDiscordUserProfilesService(
    repository,
    new DiscordBotUserProfileGateway(
      config.DISCORD_BOT_INTERNAL_URL,
      config.DISCORD_BOT_INTERNAL_TOKEN,
    ),
  ),
);

try {
  const summary = await runner.run({
    mode: "force",
    batchSize: syncConfig.DISCORD_PROFILE_SYNC_BATCH_SIZE,
    concurrency: syncConfig.DISCORD_PROFILE_SYNC_CONCURRENCY,
  });
  console.info(
    JSON.stringify({
      event: "discord-profile-sync.completed",
      mode: "force",
      ...summary,
    }),
  );
} catch (error) {
  console.error(
    JSON.stringify({
      event: "discord-profile-sync.failed",
      errorName: error instanceof Error ? error.name : "UnknownError",
    }),
  );
  process.exitCode = 1;
} finally {
  await connection.sql.end();
}
