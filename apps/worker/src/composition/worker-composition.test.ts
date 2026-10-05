import type { Job } from "bullmq";
import { describe, expect, it, vi } from "vitest";
import { createWorkerJobHandler } from "./worker-job-handler.js";
import { AdmissionTechnicalFailure } from "../admission-validation/application/admission-validation.service.js";
import { UnrecoverableError } from "bullmq";
import { createWorkerRuntime } from "./create-worker-runtime.js";

function fakeJob(name: string, attemptsMade = 0): Job {
  return {
    name,
    id: "job-1",
    data: { chapterId: "chapter-1" },
    attemptsMade,
    opts: { attempts: 2 },
  } as Job;
}

describe("Worker composition", () => {
  it("completes an expected Admission rejection without a second BullMQ attempt", async () => {
    const validate = vi.fn().mockResolvedValue(undefined);
    const handler = createWorkerJobHandler({
      logger: { info: vi.fn() },
      deletion: { execute: vi.fn() },
      loadImageProcessingWarnings: vi.fn().mockResolvedValue({}),
      createExtractor: vi.fn(),
      createChapterProcessing: vi.fn(),
      createReplacementProcessing: vi.fn(),
      createAdmissionValidation: () => ({ validate }),
    } as never);
    await expect(
      handler({
        ...fakeJob("chapter.upload.validate"),
        data: { uploadId: "upload-1" },
      } as Job),
    ).resolves.toBeUndefined();
    expect(validate).toHaveBeenCalledOnce();
  });

  it("marks a permanent Admission technical failure unrecoverable", async () => {
    const handler = createWorkerJobHandler({
      logger: { info: vi.fn() },
      deletion: { execute: vi.fn() },
      loadImageProcessingWarnings: vi.fn().mockResolvedValue({}),
      createExtractor: vi.fn(),
      createChapterProcessing: vi.fn(),
      createReplacementProcessing: vi.fn(),
      createAdmissionValidation: () => ({
        validate: vi
          .fn()
          .mockRejectedValue(
            new AdmissionTechnicalFailure(
              false,
              "STORAGE_AUTHENTICATION_FAILED",
            ),
          ),
      }),
    } as never);
    await expect(
      handler({
        ...fakeJob("chapter.upload.validate"),
        data: { uploadId: "upload-1" },
      } as Job),
    ).rejects.toBeInstanceOf(UnrecoverableError);
  });

  it("routes each queue job to its existing handler and computes finalAttempt in the handler", async () => {
    const deletion = vi.fn();
    const processing = vi.fn();
    const replacement = vi.fn();
    const loadImageProcessingWarnings = vi.fn().mockResolvedValue({
      warnImageBytes: 8,
      warnWidthPx: 4000,
      warnHeightPx: 12000,
    });
    const createExtractor = vi.fn().mockReturnValue({});
    const handler = createWorkerJobHandler({
      logger: { info: vi.fn() },
      deletion: { execute: deletion },
      loadImageProcessingWarnings,
      createExtractor,
      createChapterProcessing: () => ({ process: processing }),
      createReplacementProcessing: () => ({ process: replacement }),
    } as never);

    await handler(fakeJob("chapter.delete"));
    expect(deletion).toHaveBeenCalledOnce();
    expect(loadImageProcessingWarnings).not.toHaveBeenCalled();
    await handler(fakeJob("chapter.replacement.process"));
    expect(replacement).toHaveBeenCalledOnce();
    await handler(fakeJob("chapter.process", 1));
    expect(processing).toHaveBeenCalledWith({ chapterId: "chapter-1" }, true, {
      jobId: "job-1",
      jobAttempt: 2,
    });
    expect(createExtractor).toHaveBeenCalledWith({
      warnImageBytes: 8,
      warnWidthPx: 4000,
      warnHeightPx: 12000,
    });
  });

  it("keeps the durable request origin in replacement Worker logs and payload", async () => {
    const info = vi.fn();
    const replacement = vi.fn();
    const handler = createWorkerJobHandler({
      logger: { info },
      deletion: { execute: vi.fn() },
      loadImageProcessingWarnings: vi.fn().mockResolvedValue({}),
      createExtractor: vi.fn().mockReturnValue({}),
      createChapterProcessing: () => ({ process: vi.fn() }),
      createReplacementProcessing: () => ({ process: replacement }),
    } as never);
    const job = {
      ...fakeJob("chapter.replacement.process"),
      data: {
        chapterId: "chapter-1",
        replacementId: "replacement-1",
        originRequestId: "request-complete",
      },
    } as Job;
    await handler(job);
    expect(replacement).toHaveBeenCalledWith(job.data, false, {
      jobId: "job-1",
      jobAttempt: 1,
    });
    expect(info).toHaveBeenCalledWith(
      expect.objectContaining({
        jobId: "job-1",
        replacementId: "replacement-1",
        originRequestId: "request-complete",
      }),
      "Worker job started",
    );
  });

  it("starts background processors once and stops the Worker and DB idempotently", async () => {
    const close = vi.fn().mockResolvedValue(undefined);
    const end = vi.fn().mockResolvedValue(undefined);
    const mediaStart = vi.fn();
    const mediaStop = vi.fn();
    const cleanupStart = vi.fn();
    const cleanupStop = vi.fn();
    const factory = vi.fn().mockReturnValue({ on: vi.fn(), close });
    const runtime = createWorkerRuntime(
      {
        config: {
          REDIS_URL: "redis://localhost:6379",
          DATABASE_URL: "postgres://localhost/db",
        },
        processing: { PROCESSING_QUEUE_NAME: "chapter-processing" },
        storageConfig: { provider: "filesystem" },
        logger: { error: vi.fn(), info: vi.fn() },
        database: { sql: { end } },
        mediaEffects: { start: mediaStart, stop: mediaStop },
        storageCleanup: { start: cleanupStart, stop: cleanupStop },
      } as never,
      factory,
    );
    runtime.start();
    runtime.start();
    expect(mediaStart).toHaveBeenCalledOnce();
    expect(cleanupStart).toHaveBeenCalledOnce();
    await runtime.stop();
    await runtime.stop();
    expect(mediaStop).toHaveBeenCalledOnce();
    expect(cleanupStop).toHaveBeenCalledOnce();
    expect(close).toHaveBeenCalledOnce();
    expect(end).toHaveBeenCalledOnce();
    expect(factory).toHaveBeenCalledOnce();
  });
});
