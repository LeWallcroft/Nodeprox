import { loadConfig } from "@nodeprox/config";
import { createDatabase } from "../../../../database/client.js";
import { SyncDiscordUserProfilesService } from "../modules/discord/application/sync-discord-user-profiles.service.js";
import { DiscordBotUserProfileGateway } from "../modules/discord/infrastructure/discord-bot-user-profile.gateway.js";
import { DrizzleDiscordProfileRepository } from "../modules/discord/infrastructure/persistence/drizzle/discord-profile.repository.js";

const config = loadConfig();
if (!config.DISCORD_BOT_INTERNAL_URL || !config.DISCORD_BOT_INTERNAL_TOKEN)
  throw new Error("discord-bot-internal-configuration-required");

const connection = createDatabase(config.DATABASE_URL);
const service = new SyncDiscordUserProfilesService(
  new DrizzleDiscordProfileRepository(connection.db),
  new DiscordBotUserProfileGateway(
    config.DISCORD_BOT_INTERNAL_URL,
    config.DISCORD_BOT_INTERNAL_TOKEN,
  ),
);

try {
  let afterId: string | undefined;
  let processed = 0;
  let updated = 0;
  let skipped = 0;
  let failed = 0;
  do {
    const result = await service.syncBatch({
      ...(afterId ? { afterId } : {}),
      limit: 200,
      concurrency: 5,
    });
    processed += result.processed;
    updated += result.updated;
    skipped += result.skipped;
    failed += result.failed;
    for (const failure of result.failures)
      console.error(
        JSON.stringify({ event: "discord-profile-sync-failed", ...failure }),
      );
    afterId = result.nextCursor ?? undefined;
    if (result.processed === 0) break;
  } while (afterId);
  console.info(
    JSON.stringify({
      event: "discord-profile-sync-completed",
      processed,
      updated,
      skipped,
      failed,
    }),
  );
} finally {
  await connection.sql.end();
}
