import type { NodeProxDiscordProfileSyncConfig } from "@nodeprox/config";
import type { DiscordProfileSyncLogger } from "../application/discord-profile-sync.runner.js";
import type { DiscordProfileSyncCoordinator } from "../application/discord-profile-sync.coordinator.js";

export class DiscordProfileSyncRuntime {
  private timer: ReturnType<typeof setTimeout> | null = null;
  private activeExecution: Promise<void> | null = null;
  private started = false;
  private stopped = false;
  private stopping: Promise<void> | null = null;

  constructor(
    private readonly coordinator: DiscordProfileSyncCoordinator,
    private readonly config: NodeProxDiscordProfileSyncConfig,
    private readonly logger: DiscordProfileSyncLogger,
    private readonly clock: () => Date = () => new Date(),
    private readonly schedule: typeof setTimeout = setTimeout,
    private readonly cancel: typeof clearTimeout = clearTimeout,
  ) {}

  start(): void {
    if (this.started || this.stopped) return;
    this.started = true;
    this.scheduleNext(
      Math.min(this.config.DISCORD_PROFILE_SYNC_INTERVAL_MS, 5 * 60_000),
    );
  }

  stop(): Promise<void> {
    if (this.stopping) return this.stopping;
    this.stopped = true;
    if (this.timer) {
      this.cancel(this.timer);
      this.timer = null;
    }
    this.stopping = (async () => {
      await this.activeExecution;
      await this.coordinator.waitForIdle();
    })();
    return this.stopping;
  }

  private scheduleNext(delayMs: number): void {
    if (this.stopped || this.timer) return;
    this.timer = this.schedule(() => {
      this.timer = null;
      this.activeExecution = this.execute()
        .catch((error: unknown) => {
          this.logger.error(
            {
              event: "discord-profile-sync.failed",
              errorName: error instanceof Error ? error.name : "UnknownError",
              mode: "stale",
            },
            "Scheduled Discord profile synchronization failed",
          );
        })
        .finally(() => {
          this.activeExecution = null;
          this.scheduleNext(this.config.DISCORD_PROFILE_SYNC_INTERVAL_MS);
        });
    }, delayMs);
  }

  private async execute(): Promise<void> {
    const accepted = await this.coordinator.trigger({
      mode: "stale",
      staleBefore: new Date(
        this.clock().getTime() - this.config.DISCORD_PROFILE_SYNC_INTERVAL_MS,
      ),
    });
    if (!accepted.accepted) return;
    await this.coordinator.waitForIdle();
  }
}
