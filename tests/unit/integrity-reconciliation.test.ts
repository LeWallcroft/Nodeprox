import { Readable } from "node:stream";
import { createHash } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import {
  IntegrityReconciliationService,
  type IntegrityRepositoryPort,
  type ReconciliationBatch,
  type ReconciliationQueuePort,
} from "../../apps/api/src/modules/reconciliation/application/integrity-reconciliation.service.js";
import type { StoragePort } from "@nodeprox/storage/port";

const old = new Date("2020-01-01T00:00:00.000Z");
const now = new Date("2020-01-02T00:00:00.000Z");
const empty = (): ReconciliationBatch => ({
  intents: [],
  ready: [],
  candidates: [],
  attempts: [],
  sources: [],
  cleanupIntents: [],
  nextCursor: {},
});

function setup(batch: ReconciliationBatch) {
  const repository: IntegrityRepositoryPort = {
    scan: vi.fn().mockResolvedValue(batch),
    markEnqueued: vi.fn().mockResolvedValue(undefined),
    isPublishedKey: vi.fn().mockResolvedValue(false),
    withCandidateCleanupLock: vi
      .fn<IntegrityRepositoryPort["withCandidateCleanupLock"]>()
      .mockImplementation(async (_candidate, cleanup) => {
        await cleanup();
        return true;
      }),
    markAttemptFailed: vi.fn().mockResolvedValue(undefined),
    findProcessingIntent: vi.fn().mockResolvedValue(null),
  };
  const queue: ReconciliationQueuePort = {
    state: vi.fn().mockResolvedValue("missing"),
    enqueue: vi.fn().mockResolvedValue(undefined),
  };
  const storage: StoragePort = {
    put: vi.fn(),
    get: vi.fn().mockResolvedValue(Readable.from([Buffer.from("object")])),
    exists: vi.fn().mockResolvedValue(true),
    delete: vi.fn().mockResolvedValue(undefined),
  };
  const logger = { info: vi.fn(), error: vi.fn() };
  const service = new IntegrityReconciliationService(
    repository,
    queue,
    storage,
    logger,
    () => now,
  );
  return { repository, queue, storage, logger, service };
}

const processingIntent = {
  kind: "processing" as const,
  id: "outbox-1",
  chapterId: "chapter-1",
  status: "enqueued" as const,
  jobId: "job-1",
  aggregateStatus: "uploaded",
  payload: {
    chapterId: "chapter-1",
    uploadId: "upload-1",
    seriesId: "series-1",
    sourceStorageKey: "uploads/source.zip",
  },
  updatedAt: old,
};

describe("integrity reconciliation", () => {
  it("leaves a ready Chapter with a present canonical object unchanged", async () => {
    const batch = empty();
    batch.ready.push({
      id: "version-1",
      chapterId: "chapter-1",
      storageKey: "Media/a/1/01.jpg",
      canonicalStorageKey: "Media/a/1/01.jpg",
    });
    const target = setup(batch);
    expect((await target.service.run({ limit: 10 })).findings).toEqual([]);
    expect(target.storage.delete).not.toHaveBeenCalled();
  });

  it("reports missing published media for manual review without changing Chapter state", async () => {
    const batch = empty();
    batch.ready.push({
      id: "version-1",
      chapterId: "chapter-1",
      storageKey: "Media/a/1/01.jpg",
      canonicalStorageKey: "Media/a/1/01.jpg",
    });
    const target = setup(batch);
    vi.mocked(target.storage.exists).mockResolvedValue(false);
    expect((await target.service.run({ limit: 10 })).findings).toMatchObject([
      { code: "missing-storage-object", action: "manual-review" },
    ]);
    expect(target.storage.delete).not.toHaveBeenCalled();
  });

  it("does not requeue an enqueued job that still exists", async () => {
    const batch = empty();
    batch.intents.push(processingIntent);
    const target = setup(batch);
    vi.mocked(target.queue.state).mockResolvedValue("waiting");
    expect((await target.service.run({ limit: 10 })).findings).toEqual([]);
    expect(target.queue.enqueue).not.toHaveBeenCalled();
  });

  it("requeues a missing job with its stable identity, and dry-run does not mutate", async () => {
    const batch = empty();
    batch.intents.push(processingIntent);
    const target = setup(batch);
    const dry = await target.service.run({ limit: 10, dryRun: true });
    expect(dry.findings).toMatchObject([
      {
        code: "missing-queue-job",
        action: "requeue",
        result: "detected",
        jobId: "job-1",
      },
    ]);
    expect(target.queue.enqueue).not.toHaveBeenCalled();
    const repaired = await target.service.run({ limit: 10 });
    expect(repaired.repaired).toBe(1);
    expect(target.queue.enqueue).toHaveBeenCalledWith(processingIntent);
    expect(target.repository.markEnqueued).toHaveBeenCalledWith(
      processingIntent,
    );
  });

  it("reports a missing replacement job with its durable HTTP origin", async () => {
    const batch = empty();
    batch.intents.push({
      kind: "replacement",
      id: "replacement-intent",
      chapterId: "chapter-1",
      originRequestId: "request-complete",
      status: "enqueued",
      jobId: "chapter-replacement-replacement-1",
      aggregateStatus: "uploaded",
      payload: {
        replacementId: "replacement-1",
        chapterId: "chapter-1",
        originRequestId: "request-complete",
      },
      updatedAt: old,
    });
    const target = setup(batch);
    expect(
      (await target.service.run({ limit: 10, dryRun: true })).findings,
    ).toMatchObject([
      { code: "missing-queue-job", originRequestId: "request-complete" },
    ]);
    await target.service.run({ limit: 10 });
    expect(target.queue.enqueue).toHaveBeenCalledWith(batch.intents[0]);
  });

  it("does not enqueue a second logical job after a successful repair", async () => {
    const batch = empty();
    batch.intents.push(processingIntent);
    const target = setup(batch);
    vi.mocked(target.queue.state)
      .mockResolvedValueOnce("missing")
      .mockResolvedValueOnce("waiting");
    expect((await target.service.run({ limit: 10 })).repaired).toBe(1);
    expect((await target.service.run({ limit: 10 })).repaired).toBe(0);
    expect(target.queue.enqueue).toHaveBeenCalledTimes(1);
  });

  it("recovers a stale attempt only with a known source and first job invocation", async () => {
    const batch = empty();
    batch.attempts.push({
      id: "attempt-1",
      chapterId: "chapter-1",
      uploadId: "upload-1",
      jobId: "job-1",
      jobAttempt: 1,
      chapterStatus: "processing",
      sourceStorageKey: "uploads/source.zip",
      status: "processing",
      startedAt: old,
    });
    const target = setup(batch);
    vi.mocked(target.repository.findProcessingIntent).mockResolvedValue(
      processingIntent,
    );
    expect((await target.service.run({ limit: 10 })).findings).toMatchObject([
      {
        code: "stale-processing-attempt",
        action: "requeue",
        result: "repaired",
      },
    ]);
    expect(target.queue.enqueue).toHaveBeenCalledWith(processingIntent);
  });

  it("persists a terminal outcome for an exhausted job with no durable result", async () => {
    const batch = empty();
    const attempt = {
      id: "attempt-1",
      chapterId: "chapter-1",
      uploadId: "upload-1",
      jobId: "job-1",
      jobAttempt: 3,
      chapterStatus: "processing",
      sourceStorageKey: "uploads/source.zip",
      status: "processing",
      startedAt: old,
    };
    batch.attempts.push(attempt);
    const target = setup(batch);
    vi.mocked(target.queue.state).mockResolvedValue("failed");
    expect((await target.service.run({ limit: 10 })).findings).toMatchObject([
      {
        code: "stale-processing-attempt",
        action: "mark-failed",
        result: "repaired",
      },
    ]);
    expect(target.repository.markAttemptFailed).toHaveBeenCalledWith(
      attempt,
      "PROCESSING_UNKNOWN",
    );
  });

  it("flags a completed queue job with a still-processing attempt for manual review", async () => {
    const batch = empty();
    batch.attempts.push({
      id: "attempt-1",
      chapterId: "chapter-1",
      uploadId: "upload-1",
      jobId: "job-1",
      jobAttempt: 1,
      chapterStatus: "processing",
      sourceStorageKey: "uploads/source.zip",
      status: "processing",
      startedAt: old,
    });
    const target = setup(batch);
    vi.mocked(target.queue.state).mockResolvedValue("completed");
    expect((await target.service.run({ limit: 10 })).findings).toMatchObject([
      { code: "stale-processing-attempt", action: "manual-review" },
    ]);
    expect(target.repository.markAttemptFailed).not.toHaveBeenCalled();
  });

  it("cleans only a confirmed non-published candidate with matching bytes", async () => {
    const batch = empty();
    batch.candidates.push({
      id: "object-1",
      attemptId: "attempt-1",
      chapterId: "chapter-1",
      uploadId: "upload-1",
      storageKey: "Media/a/1/01.jpg",
      checksum: createHash("sha256").update("object").digest("hex"),
      status: "cleanup_pending",
      attemptStatus: "terminal_failed",
      createdAt: old,
    });
    const target = setup(batch);
    expect((await target.service.run({ limit: 10 })).findings).toMatchObject([
      { code: "orphan-storage-object", action: "cleanup", result: "repaired" },
    ]);
    expect(target.storage.delete).toHaveBeenCalledWith("Media/a/1/01.jpg");
    expect(target.repository.withCandidateCleanupLock).toHaveBeenCalledWith(
      expect.objectContaining({ id: "object-1" }),
      expect.any(Function),
    );
  });

  it("keeps candidate cleanup durable when storage deletion fails", async () => {
    const batch = empty();
    batch.candidates.push({
      id: "object-1",
      attemptId: "attempt-1",
      chapterId: "chapter-1",
      uploadId: "upload-1",
      storageKey: "Media/a/1/01.jpg",
      checksum: createHash("sha256").update("object").digest("hex"),
      status: "cleanup_pending",
      attemptStatus: "terminal_failed",
      createdAt: old,
    });
    const target = setup(batch);
    vi.mocked(target.storage.delete).mockRejectedValue(
      new Error("unavailable"),
    );
    expect((await target.service.run({ limit: 10 })).findings).toMatchObject([
      { action: "cleanup", result: "repair-failed" },
    ]);
    expect(target.repository.withCandidateCleanupLock).toHaveBeenCalledTimes(1);
  });

  it("does not delete when a worker wins the Chapter lock before cleanup", async () => {
    const batch = empty();
    batch.candidates.push({
      id: "object-1",
      attemptId: "attempt-1",
      chapterId: "chapter-1",
      uploadId: "upload-1",
      storageKey: "Media/a/1/01.jpg",
      checksum: createHash("sha256").update("object").digest("hex"),
      status: "cleanup_pending",
      attemptStatus: "terminal_failed",
      createdAt: old,
    });
    const target = setup(batch);
    vi.mocked(target.repository.withCandidateCleanupLock).mockResolvedValue(
      false,
    );
    expect((await target.service.run({ limit: 10 })).findings).toMatchObject([
      { action: "cleanup", result: "repair-failed" },
    ]);
    expect(target.storage.delete).not.toHaveBeenCalled();
  });

  it("never deletes a candidate still referenced by publication or with unknown content", async () => {
    const batch = empty();
    batch.candidates.push({
      id: "object-1",
      attemptId: "attempt-1",
      chapterId: "chapter-1",
      uploadId: "upload-1",
      storageKey: "Media/a/1/01.jpg",
      checksum: "different",
      status: "created",
      attemptStatus: "terminal_failed",
      createdAt: old,
    });
    const target = setup(batch);
    expect((await target.service.run({ limit: 10 })).findings).toMatchObject([
      { action: "manual-review" },
    ]);
    vi.mocked(target.repository.isPublishedKey).mockResolvedValue(true);
    expect((await target.service.run({ limit: 10 })).findings).toMatchObject([
      { action: "manual-review" },
    ]);
    expect(target.storage.delete).not.toHaveBeenCalled();
  });

  it("flags storage key drift and cleans a succeeded attempt source without changing publication", async () => {
    const batch = empty();
    batch.ready.push({
      id: "version-1",
      chapterId: "chapter-1",
      storageKey: "Media/wrong/1/01.jpg",
      canonicalStorageKey: "Media/a/1/01.jpg",
    });
    batch.sources.push({
      id: "attempt-1",
      chapterId: "chapter-1",
      uploadId: "upload-1",
      storageKey: "uploads/source.zip",
    });
    const target = setup(batch);
    expect((await target.service.run({ limit: 10 })).findings).toMatchObject([
      { code: "storage-key-mismatch", action: "manual-review" },
      { code: "cleanup-pending", action: "cleanup", result: "repaired" },
    ]);
    expect(target.storage.delete).toHaveBeenCalledTimes(1);
  });

  it("reports stalled replacement cleanup without bypassing its safety policy", async () => {
    const batch = empty();
    batch.cleanupIntents.push({
      id: "cleanup-1",
      chapterId: "chapter-1",
      storageKey: "Media/a/1/candidate.jpg",
      status: "failed",
      updatedAt: old,
      originRequestId: "request-complete",
    });
    const target = setup(batch);
    expect((await target.service.run({ limit: 10 })).findings).toMatchObject([
      {
        code: "cleanup-pending",
        action: "manual-review",
        resourceType: "cleanup-outbox",
        originRequestId: "request-complete",
      },
    ]);
    expect(target.storage.delete).not.toHaveBeenCalled();
  });
});
