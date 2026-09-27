import type { StoragePort } from "@nodeprox/storage/port";
import type {
  StorageCleanupEffect,
  StorageCleanupRepositoryPort,
} from "./ports.js";

export interface StorageCleanupLogger {
  info(context: Record<string, unknown>, message: string): void;
  warn(context: Record<string, unknown>, message: string): void;
  error(context: Record<string, unknown>, message: string): void;
}

export class StorageCleanupProcessor {
  private timer: NodeJS.Timeout | undefined;
  private running = false;

  constructor(
    private readonly repository: StorageCleanupRepositoryPort,
    private readonly storage: StoragePort,
    private readonly logger: StorageCleanupLogger,
    private readonly now: () => Date = () => new Date(),
    private readonly maxAttempts = 5,
  ) {}

  async runOnce(): Promise<void> {
    if (this.running) return;
    this.running = true;
    try {
      const effects = await this.repository.claimPending(10);
      for (const effect of effects) await this.execute(effect);
    } finally {
      this.running = false;
    }
  }

  start(intervalMs = 1000): void {
    if (this.timer) return;
    void this.runOnce();
    this.timer = setInterval(() => void this.runOnce(), intervalMs);
    this.timer.unref();
  }

  stop(): void {
    if (!this.timer) return;
    clearInterval(this.timer);
    this.timer = undefined;
  }

  private async execute(effect: StorageCleanupEffect): Promise<void> {
    const context = {
      cleanupId: effect.id,
      replacementId: effect.replacementId,
      reason: effect.reason,
      attempt: effect.attempts,
      ...(effect.originRequestId
        ? { originRequestId: effect.originRequestId }
        : {}),
    };
    try {
      if (!(await this.repository.isSafeToDelete(effect))) {
        await this.repository.markFailed(effect.id, "storage-cleanup-not-safe");
        this.logger.error(context, "Storage cleanup target is not safe");
        return;
      }
      await this.storage.delete(effect.storageKey);
      await this.repository.markCompleted(effect.id);
      this.logger.info(context, "Storage cleanup completed");
    } catch {
      if (effect.attempts < this.maxAttempts) {
        const delaySeconds = Math.min(5 * 2 ** (effect.attempts - 1), 300);
        await this.repository.markRetry(
          effect.id,
          new Date(this.now().getTime() + delaySeconds * 1000),
          "storage-cleanup-delete-failed",
        );
        this.logger.warn(context, "Storage cleanup scheduled for retry");
        return;
      }
      await this.repository.markFailed(
        effect.id,
        "storage-cleanup-delete-failed",
      );
      this.logger.error(context, "Storage cleanup failed");
    }
  }
}
