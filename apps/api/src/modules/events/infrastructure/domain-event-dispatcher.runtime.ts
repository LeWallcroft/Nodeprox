import type { DomainEventDispatcher } from "../application/domain-event-dispatcher.js";

export interface DomainEventDispatcherRuntimeLogger {
  debug(context: Record<string, unknown>, message: string): void;
  error(context: Record<string, unknown>, message: string): void;
}

export class DomainEventDispatcherRuntime {
  private timer: NodeJS.Timeout | undefined;
  private running: Promise<void> | undefined;
  private stopping = false;

  constructor(
    private readonly dispatcher: DomainEventDispatcher,
    private readonly logger: DomainEventDispatcherRuntimeLogger,
    private readonly pollIntervalMs: number,
  ) {}

  start(): void {
    if (this.timer) return;
    this.stopping = false;
    void this.dispatch();
    this.timer = setInterval(() => void this.dispatch(), this.pollIntervalMs);
    this.timer.unref();
  }

  async stop(timeoutMs: number): Promise<void> {
    this.stopping = true;
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = undefined;
    }
    const running = this.running;
    if (!running) return;
    await Promise.race([
      running,
      new Promise<void>((resolve) => setTimeout(resolve, timeoutMs)),
    ]);
  }

  private async dispatch(): Promise<void> {
    if (this.stopping || this.running) return;
    const running = this.runBatch();
    this.running = running;
    try {
      await running;
    } finally {
      if (this.running === running) this.running = undefined;
    }
  }

  private async runBatch(): Promise<void> {
    try {
      const result = await this.dispatcher.runOnce();
      if (result.claimed > 0)
        this.logger.debug(
          { ...result },
          "Domain event dispatcher batch completed",
        );
    } catch (error) {
      this.logger.error(
        { errorName: error instanceof Error ? error.name : "unknown" },
        "Domain event dispatcher batch failed",
      );
    }
  }
}
