import type { DiscordUserProfileGateway } from "./discord-user-profile.gateway.js";
import type { DiscordProfileRepository } from "./discord-profile.repository.js";

export class SyncDiscordUserProfilesService {
  constructor(
    private readonly repository: DiscordProfileRepository,
    private readonly profiles: DiscordUserProfileGateway,
  ) {}

  async syncBatch(input: {
    afterId?: string;
    limit: number;
    concurrency: number;
  }): Promise<{
    processed: number;
    updated: number;
    skipped: number;
    failed: number;
    nextCursor: string | null;
    failures: readonly { userId: string; code: string }[];
  }> {
    const rows = await this.repository.listLinked(input);
    let next = 0;
    let updated = 0;
    let skipped = 0;
    const failures: { userId: string; code: string }[] = [];
    const worker = async () => {
      while (true) {
        const row = rows[next++];
        if (!row) return;
        try {
          const profile = await this.profiles.getProfile(row.discordId);
          if (!profile) {
            skipped += 1;
            continue;
          }
          if (
            await this.repository.updateDiscordProfile({
              userId: row.userId,
              expectedDiscordId: row.discordId,
              discordUsername: profile.username,
              avatarUrl: profile.avatarUrl,
            })
          )
            updated += 1;
          else skipped += 1;
        } catch (error) {
          failures.push({
            userId: row.userId,
            code:
              error instanceof Error
                ? error.name || "discord-profile-sync-failed"
                : "discord-profile-sync-failed",
          });
        }
      }
    };
    const concurrency = Math.max(
      1,
      Math.min(16, Math.floor(input.concurrency)),
    );
    await Promise.all(Array.from({ length: concurrency }, worker));
    return {
      processed: rows.length,
      updated,
      skipped,
      failed: failures.length,
      nextCursor:
        rows.length === input.limit ? (rows.at(-1)?.userId ?? null) : null,
      failures,
    };
  }
}
