import { describe, expect, it, vi } from "vitest";
import { Readable } from "node:stream";
import { AdmissionValidationService } from "../admission-validation/application/admission-validation.service.js";
import { measureStage } from "./application/measure-stage.js";
import type { PerformanceObserverPort } from "./application/performance-observer.port.js";
import { BufferedPerformanceObserver } from "./infrastructure/buffered-performance-observer.js";
import { noopPerformanceObserver } from "./infrastructure/noop-performance-observer.js";
import { loadWorkerPerformanceConfig } from "./infrastructure/worker-performance-config.js";

const result = {
  jobName: "chapter.process" as const,
  jobId: "job-1",
  jobAttempt: 2,
  outcome: "success" as const,
  handlerDurationMs: 12,
};

describe("Worker performance observability", () => {
  it("is disabled by default and validates sampling only when enabled", () => {
    expect(loadWorkerPerformanceConfig({})).toEqual({
      enabled: false,
      sampleRate: 0,
    });
    expect(
      loadWorkerPerformanceConfig({ NODEPROX_WORKER_PERF_SAMPLE_RATE: "bad" }),
    ).toEqual({ enabled: false, sampleRate: 0 });
    expect(
      loadWorkerPerformanceConfig({ NODEPROX_WORKER_PERF_ENABLED: "true" }),
    ).toEqual({ enabled: true, sampleRate: 1 });
    expect(
      loadWorkerPerformanceConfig({
        NODEPROX_WORKER_PERF_ENABLED: "true",
        NODEPROX_WORKER_PERF_SAMPLE_RATE: "0.25",
      }),
    ).toEqual({ enabled: true, sampleRate: 0.25 });
    expect(() =>
      loadWorkerPerformanceConfig({
        NODEPROX_WORKER_PERF_ENABLED: "true",
        NODEPROX_WORKER_PERF_SAMPLE_RATE: "1.1",
      }),
    ).toThrow();
  });

  it("aggregates 100 images in bounded stage data and emits once", () => {
    const emit = vi.fn();
    const observer = new BufferedPerformanceObserver(emit);
    for (let index = 0; index < 100; index++) {
      observer.record({
        stage: "processing.image.persist_verify",
        durationMs: index + 1,
        outcome: "success",
        bytes: 10,
        objectOutcome: "created",
      });
    }
    observer.finish(result);
    observer.finish(result);
    expect(emit).toHaveBeenCalledOnce();
    const summary = emit.mock.calls[0]?.[0];
    expect(summary).toMatchObject({
      event: "worker.performance-summary.v1",
      schemaVersion: 1,
      jobName: "chapter.process",
      imageCount: 100,
      totalImageBytes: 1000,
      stages: {
        "processing.image.persist_verify": {
          count: 100,
          totalMs: 5050,
          maxMs: 100,
          errorCount: 0,
          createdCount: 100,
        },
      },
    });
    expect(Object.keys(summary.stages)).toHaveLength(1);
    expect(JSON.stringify(summary)).not.toMatch(
      /secret|filename|storageKey|checksum|stack/,
    );
  });

  it("preserves returns and original errors when record or finish fails", async () => {
    const error = new Error("original");
    const observer: PerformanceObserverPort = {
      enabled: true,
      record: () => {
        throw new Error("observer");
      },
      finish: () => {
        throw new Error("logger");
      },
    };
    await expect(
      measureStage(observer, "processing.claim", async () => 42),
    ).resolves.toBe(42);
    await expect(
      measureStage(observer, "processing.claim", async () => {
        throw error;
      }),
    ).rejects.toBe(error);
    await expect(
      measureStage(noopPerformanceObserver, "processing.claim", async () => 7),
    ).resolves.toBe(7);
    const emit = vi.fn(() => {
      throw new Error("logger");
    });
    expect(() =>
      new BufferedPerformanceObserver(emit).finish(result),
    ).not.toThrow();
  });

  it("records finite nonnegative elapsed time for both outcomes", async () => {
    const samples: unknown[] = [];
    const observer: PerformanceObserverPort = {
      enabled: true,
      record: (sample) => {
        samples.push(sample);
      },
      finish: vi.fn(),
    };
    await measureStage(observer, "processing.claim", async () => undefined);
    await expect(
      measureStage(observer, "processing.claim", async () => {
        throw new Error("failure");
      }),
    ).rejects.toThrow("failure");
    expect(samples).toHaveLength(2);
    expect(samples).toEqual([
      expect.objectContaining({
        outcome: "success",
        durationMs: expect.any(Number),
      }),
      expect.objectContaining({
        outcome: "error",
        durationMs: expect.any(Number),
      }),
    ]);
    for (const sample of samples as { durationMs: number }[]) {
      expect(Number.isFinite(sample.durationMs)).toBe(true);
      expect(sample.durationMs).toBeGreaterThanOrEqual(0);
    }
  });

  it("measures Admission ZIP inspection through complete stream consumption", async () => {
    let release: (() => void) | undefined;
    const pending = new Promise<void>((resolve) => {
      release = resolve;
    });
    const samples: { stage: string; durationMs: number }[] = [];
    const observer: PerformanceObserverPort = {
      enabled: true,
      record: (sample) => {
        samples.push(sample);
      },
      finish: vi.fn(),
    };
    const settle = vi.fn().mockResolvedValue(undefined);
    const storage = {
      get: vi.fn().mockResolvedValue(
        Readable.from(
          (async function* () {
            await pending;
            yield Buffer.from("zip");
          })(),
        ),
      ),
    };
    const inspector = {
      inspect: vi.fn(async (source: Readable) => {
        for await (const _chunk of source) {
          /* consume the stream */
        }
        return { status: "accepted" };
      }),
    };
    const service = new AdmissionValidationService(
      {
        begin: vi.fn().mockResolvedValue({
          runId: "run-1",
          storageProfileId: "profile-1",
          sourceStorageKey: "private-key",
        }),
        settle,
        fail: vi.fn(),
      } as never,
      { storageFor: vi.fn().mockResolvedValue(storage) } as never,
      inspector as never,
      observer,
    );
    const validation = service.validate({
      uploadId: "upload-1",
      jobId: "job-1",
      jobAttempt: 1,
      finalAttempt: false,
    });
    await vi.waitFor(() => expect(inspector.inspect).toHaveBeenCalledOnce());
    expect(samples.map((sample) => sample.stage)).not.toContain(
      "admission.zip.fetch_inspect",
    );
    release?.();
    await validation;
    expect(samples.map((sample) => sample.stage)).toEqual([
      "admission.begin",
      "admission.zip.fetch_inspect",
      "admission.settle",
    ]);
    expect(settle).toHaveBeenCalledOnce();
  });
});
