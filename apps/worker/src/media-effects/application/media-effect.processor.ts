import type { StoragePort } from "@nodeprox/storage/port";
import type {
  CdnInvalidationPort,
  ClaimedMediaEffect,
  MediaEffectRepositoryPort,
} from "./ports.js";
import { CdnInvalidationError } from "./ports.js";

export interface MediaEffectLogger {
  info(context: Record<string, unknown>, message: string): void;
  warn(context: Record<string, unknown>, message: string): void;
  error(context: Record<string, unknown>, message: string): void;
}

export class MediaEffectProcessor {
  private timer: NodeJS.Timeout | undefined;
  private running = false;

  constructor(
    private readonly repository: MediaEffectRepositoryPort,
    private readonly cdn: CdnInvalidationPort,
    private readonly storage: StoragePort,
    private readonly logger: MediaEffectLogger,
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

  private async execute(effect: ClaimedMediaEffect): Promise<void> {
    const context = {
      effectId: effect.id,
      effectType: effect.effectType,
      imageId: effect.imageId,
      attempt: effect.attempts,
    };
    try {
      if (effect.effectType === "cdn_purge")
        await this.cdn.purgeUrls([effect.target]);
      else {
        if (
          await this.repository.isCurrentStorageKey(
            effect.imageId,
            effect.target,
          )
        ) {
          await this.repository.markFailed(
            effect.id,
            "media-effect-target-current",
          );
          this.logger.error(context, "Media cleanup target is current");
          return;
        }
        await this.storage.delete(effect.target);
      }
      await this.repository.markCompleted(effect.id);
      this.logger.info(context, "Media infrastructure effect completed");
    } catch (error) {
      const failure = classifyFailure(error);
      if (failure.retryable && effect.attempts < this.maxAttempts) {
        const delaySeconds = Math.min(5 * 2 ** (effect.attempts - 1), 300);
        await this.repository.markRetry(
          effect.id,
          new Date(this.now().getTime() + delaySeconds * 1000),
          failure.code,
        );
        this.logger.warn(
          { ...context, code: failure.code },
          "Media infrastructure effect scheduled for retry",
        );
        return;
      }
      await this.repository.markFailed(effect.id, failure.code);
      this.logger.error(
        { ...context, code: failure.code },
        "Media infrastructure effect failed",
      );
    }
  }
}

function classifyFailure(error: unknown): {
  code: string;
  retryable: boolean;
} {
  if (error instanceof CdnInvalidationError)
    return { code: error.code, retryable: error.retryable };
  return { code: "storage-delete-failed", retryable: true };
}
