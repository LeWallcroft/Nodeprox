import type { DiscordUserProfileGateway } from "./discord-user-profile.gateway.js";
import { DiscordUserProfileUnavailableError } from "./discord-user-profile.gateway.js";
import type { DiscordProfileRepository } from "./discord-profile.repository.js";

export type DiscordTargetedProfileSyncResult =
  | "changed"
  | "refreshed"
  | "not-linked"
  | "link-changed"
  | "unavailable";

export class SyncDiscordUserProfilesService {
  constructor(
    private readonly repository: DiscordProfileRepository,
    private readonly profiles: DiscordUserProfileGateway,
    private readonly clock: () => Date = () => new Date(),
  ) {}

  async syncLinkedProfileByDiscordId(
    discordId: string,
  ): Promise<DiscordTargetedProfileSyncResult> {
    const linked = await this.repository.findLinkedByDiscordId(discordId);
    if (!linked) return "not-linked";
    try {
      const profile = await this.profiles.getProfile(discordId, {
        force: true,
      });
      if (!profile) return "unavailable";
      return await this.repository.updateDiscordProfile({
        userId: linked.userId,
        expectedDiscordId: discordId,
        discordUsername: profile.username,
        avatarUrl: profile.avatarUrl,
        syncedAt: this.clock(),
      });
    } catch (error) {
      if (error instanceof DiscordUserProfileUnavailableError)
        return "unavailable";
      throw error;
    }
  }

  async syncBatch(input: {
    afterId?: string;
    limit: number;
    concurrency: number;
    staleBefore?: Date;
  }): Promise<{
    processed: number;
    changed: number;
    refreshed: number;
    skipped: number;
    failed: number;
    nextCursor: string | null;
    failures: readonly { userId: string; code: string }[];
  }> {
    const rows = await this.repository.listLinked(input);
    let next = 0;
    let changed = 0;
    let refreshed = 0;
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
          const result = await this.repository.updateDiscordProfile({
            userId: row.userId,
            expectedDiscordId: row.discordId,
            discordUsername: profile.username,
            avatarUrl: profile.avatarUrl,
            syncedAt: this.clock(),
          });
          if (result === "changed") changed += 1;
          else if (result === "refreshed") refreshed += 1;
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
      changed,
      refreshed,
      skipped,
      failed: failures.length,
      nextCursor:
        rows.length === input.limit ? (rows.at(-1)?.userId ?? null) : null,
      failures,
    };
  }
}
