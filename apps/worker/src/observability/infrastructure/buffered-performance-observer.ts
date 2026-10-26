import type {
  InvocationResult,
  PerformanceObserverPort,
  PerformanceStageName,
  StageAggregate,
  TimingSample,
} from "../application/performance-observer.port.js";

type MutableAggregate = {
  count: number;
  totalMs: number;
  maxMs: number;
  errorCount: number;
  bytes: number;
  createdCount: number;
  reusedCount: number;
  conflictCount: number;
};

export class BufferedPerformanceObserver implements PerformanceObserverPort {
  readonly enabled = true;
  private readonly stages = new Map<PerformanceStageName, MutableAggregate>();
  private imageCount = 0;
  private totalImageBytes = 0;
  private finished = false;

  constructor(
    private readonly emit: (summary: Record<string, unknown>) => void,
  ) {}

  record(sample: TimingSample): void {
    if (
      this.finished ||
      !Number.isFinite(sample.durationMs) ||
      sample.durationMs < 0
    )
      return;
    const aggregate = this.stages.get(sample.stage) ?? {
      count: 0,
      totalMs: 0,
      maxMs: 0,
      errorCount: 0,
      bytes: 0,
      createdCount: 0,
      reusedCount: 0,
      conflictCount: 0,
    };
    aggregate.count++;
    aggregate.totalMs += sample.durationMs;
    aggregate.maxMs = Math.max(aggregate.maxMs, sample.durationMs);
    if (sample.outcome === "error") aggregate.errorCount++;
    if (
      sample.bytes !== undefined &&
      Number.isFinite(sample.bytes) &&
      sample.bytes >= 0
    )
      aggregate.bytes += sample.bytes;
    this.stages.set(sample.stage, aggregate);
    if (
      sample.stage === "processing.image.persist_verify" &&
      sample.outcome === "success"
    ) {
      this.imageCount++;
      this.totalImageBytes += sample.bytes ?? 0;
    }
    if (sample.objectOutcome === "created") aggregate.createdCount++;
    if (sample.objectOutcome === "existing-equivalent") aggregate.reusedCount++;
    if (sample.objectOutcome === "existing-conflict") aggregate.conflictCount++;
  }

  finish(result: InvocationResult): void {
    if (this.finished) return;
    this.finished = true;
    const stages: Partial<Record<PerformanceStageName, StageAggregate>> = {};
    for (const [stage, aggregate] of this.stages)
      stages[stage] = { ...aggregate };
    try {
      this.emit({
        event: "worker.performance-summary.v1",
        schemaVersion: 1,
        jobName: result.jobName,
        jobId: result.jobId,
        jobAttempt: result.jobAttempt,
        outcome: result.outcome,
        handlerDurationMs: result.handlerDurationMs,
        imageCount: this.imageCount,
        totalImageBytes: this.totalImageBytes,
        stages,
      });
    } catch {
      // A logging failure cannot fail a BullMQ attempt.
    }
  }
}
