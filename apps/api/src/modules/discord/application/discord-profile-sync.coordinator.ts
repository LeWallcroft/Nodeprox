import type { DiscordProfileSyncLeasePort } from "./discord-profile-sync.lease.js";
import type {
  DiscordProfileSyncLogger,
  DiscordProfileSyncRunner,
} from "./discord-profile-sync.runner.js";

export class DiscordProfileSyncCoordinator {
  private running = false;
  private activeRun: Promise<void> | null = null;

  constructor(
    private readonly lease: DiscordProfileSyncLeasePort,
    private readonly runner: DiscordProfileSyncRunner,
    private readonly options: {
      batchSize: number;
      concurrency: number;
      logger?: DiscordProfileSyncLogger;
      clock?: () => Date;
    },
  ) {}

  setLogger(logger: DiscordProfileSyncLogger): void {
    this.options.logger = logger;
  }

  isRunning(): boolean {
    return this.running;
  }

  async trigger(input: {
    mode: "stale" | "force";
    staleBefore?: Date;
  }): Promise<
    { accepted: true } | { accepted: false; reason: "already-running" }
  > {
    if (this.running) return { accepted: false, reason: "already-running" };
    this.running = true;
    let lease: Awaited<ReturnType<DiscordProfileSyncLeasePort["tryAcquire"]>>;
    try {
      lease = await this.lease.tryAcquire();
    } catch (error) {
      this.running = false;
      throw error;
    }
    if (!lease) {
      this.running = false;
      this.options.logger?.info(
        { event: "discord-profile-sync.skipped-lock-held", mode: input.mode },
        "Discord profile sync skipped because another instance holds the lease",
      );
      return { accepted: false, reason: "already-running" };
    }

    this.activeRun = Promise.resolve().then(async () => {
      const startedAt = (this.options.clock ?? (() => new Date()))();
      this.options.logger?.info(
        { event: "discord-profile-sync.started", mode: input.mode },
        "Discord profile synchronization started",
      );
      try {
        const summary = await this.runner.run({
          mode: input.mode,
          ...(input.mode === "stale" && input.staleBefore
            ? { staleBefore: input.staleBefore }
            : {}),
          batchSize: this.options.batchSize,
          concurrency: this.options.concurrency,
        });
        this.options.logger?.info(
          {
            event: "discord-profile-sync.completed",
            mode: input.mode,
            processed: summary.processed,
            changed: summary.changed,
            refreshed: summary.refreshed,
            skipped: summary.skipped,
            failed: summary.failed,
            durationMs: Math.max(
              0,
              summary.completedAt.getTime() - startedAt.getTime(),
            ),
          },
          "Discord profile synchronization completed",
        );
      } catch (error) {
        this.options.logger?.error(
          {
            event: "discord-profile-sync.failed",
            mode: input.mode,
            errorName: error instanceof Error ? error.name : "UnknownError",
          },
          "Discord profile synchronization failed",
        );
      } finally {
        try {
          await lease.release();
        } catch (error) {
          this.options.logger?.error(
            {
              event: "discord-profile-sync.lease-release-failed",
              errorName: error instanceof Error ? error.name : "UnknownError",
            },
            "Discord profile synchronization lease release failed",
          );
        }
        this.running = false;
        this.activeRun = null;
      }
    });
    return { accepted: true };
  }

  async waitForIdle(): Promise<void> {
    await this.activeRun;
  }
}
