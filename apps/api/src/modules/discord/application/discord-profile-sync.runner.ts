import type { SyncDiscordUserProfilesService } from "./sync-discord-user-profiles.service.js";

export type DiscordProfileSyncMode = "stale" | "force";
export type DiscordProfileSyncSummary = {
  processed: number;
  changed: number;
  refreshed: number;
  skipped: number;
  failed: number;
  startedAt: Date;
  completedAt: Date;
};

export interface DiscordProfileSyncLogger {
  info(fields: Record<string, unknown>, message?: string): void;
  warn(fields: Record<string, unknown>, message?: string): void;
  error(fields: Record<string, unknown>, message?: string): void;
}

export class DiscordProfileSyncRunner {
  private logger?: DiscordProfileSyncLogger;

  constructor(
    private readonly batchService: SyncDiscordUserProfilesService,
    private readonly clock: () => Date = () => new Date(),
  ) {}

  setLogger(logger: DiscordProfileSyncLogger): void {
    this.logger = logger;
  }

  async run(input: {
    mode: DiscordProfileSyncMode;
    staleBefore?: Date;
    batchSize: number;
    concurrency: number;
  }): Promise<DiscordProfileSyncSummary> {
    if (input.mode === "stale" && !input.staleBefore)
      throw new Error("discord-profile-sync-stale-cutoff-required");
    const startedAt = this.clock();
    const summary = {
      processed: 0,
      changed: 0,
      refreshed: 0,
      skipped: 0,
      failed: 0,
    };
    let afterId: string | undefined;
    do {
      const result = await this.batchService.syncBatch({
        ...(afterId ? { afterId } : {}),
        limit: input.batchSize,
        concurrency: input.concurrency,
        ...(input.mode === "stale" ? { staleBefore: input.staleBefore } : {}),
      });
      summary.processed += result.processed;
      summary.changed += result.changed;
      summary.refreshed += result.refreshed;
      summary.skipped += result.skipped;
      summary.failed += result.failed;
      for (const failure of result.failures)
        this.logger?.warn(
          {
            event: "discord-profile-sync.user-failed",
            userId: failure.userId,
            errorCode: failure.code,
          },
          "Discord profile refresh failed for a linked user",
        );
      afterId = result.nextCursor ?? undefined;
      if (result.processed === 0) break;
    } while (afterId);
    const completedAt = this.clock();
    return { ...summary, startedAt, completedAt };
  }
}
