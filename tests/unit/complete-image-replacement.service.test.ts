import { describe, expect, it, vi } from "vitest";
import type {
  ImageReplacementOperation,
  ImageReplacementOperationRepository,
} from "../../apps/api/src/modules/images/application/image-replacement-operation.repository.js";
import {
  CompleteImageReplacementService,
  ImageReplacementCompletionDeniedError,
  ImageReplacementCompletionFailedError,
  ImageReplacementCompletionInvalidError,
  ImageReplacementCompletionNotFoundError,
} from "../../apps/api/src/modules/images/application/services/complete-image-replacement.service.js";
import {
  UploadTransferObjectNotFoundError,
  type UploadTransferPort,
} from "../../packages/storage/dist/port.js";
import {
  legacyStorageExecution,
  legacyStorageProfileId,
} from "../helpers/storage-execution.js";

const context = { userId: "user-1" } as never;
const queuedAt = new Date("2026-09-03T23:30:00.000Z");
const operation: ImageReplacementOperation = {
  id: "operation-1",
  imageId: "image-1",
  chapterId: "chapter-1",
  requestedByUserId: "user-1",
  candidateStorageKey: "Media/series/1/opaque.jpg",
  storageProfileId: legacyStorageProfileId,
  originalFilename: "page.jpg",
  contentType: "image/jpeg",
  sizeBytes: 20,
  status: "pending_upload",
  resultImageVersionId: null,
  lastErrorCode: null,
  createdAt: new Date("2026-09-03T23:00:00.000Z"),
  updatedAt: new Date("2026-09-03T23:00:00.000Z"),
  completedAt: null,
};

function subject(input?: {
  operation?: ImageReplacementOperation | null;
  allowed?: boolean;
  verified?: {
    key: string;
    sizeBytes: number;
    contentType?: string;
    etag?: string;
  };
}) {
  const initial = input?.operation === undefined ? operation : input.operation;
  const uploaded = initial ? { ...initial, status: "uploaded" as const } : null;
  const operations: ImageReplacementOperationRepository = {
    create: vi.fn(),
    findById: vi.fn(async () => initial),
    markUploaded: vi.fn(async () => uploaded),
    tryBeginCompletion: vi.fn(),
    markCompleted: vi.fn(),
    markFailed: vi.fn(),
  };
  const transfer: UploadTransferPort = {
    initiate: vi.fn(),
    verify: vi.fn(
      async () =>
        input?.verified ?? {
          key: operation.candidateStorageKey,
          sizeBytes: operation.sizeBytes,
          contentType: operation.contentType,
          etag: "candidate-etag",
        },
    ),
    abort: vi.fn(),
  };
  const authorization = {
    check: vi.fn(async () => ({
      allowed: input?.allowed ?? true,
      reason: "role",
    })),
  };
  const service = new CompleteImageReplacementService(
    operations,
    legacyStorageExecution(
      { put: vi.fn(), get: vi.fn(), exists: vi.fn(), delete: vi.fn() },
      transfer,
    ),
    authorization,
    () => queuedAt,
  );
  return { service, operations, transfer, authorization };
}

function execute(service: CompleteImageReplacementService) {
  return service.execute({
    context,
    chapterId: operation.chapterId,
    imageId: operation.imageId,
    replacementId: operation.id,
    requestId: "request-1",
  });
}

describe("CompleteImageReplacementService", () => {
  it("verifies the candidate and queues durable background completion", async () => {
    const target = subject();

    await expect(execute(target.service)).resolves.toEqual({
      replacementId: operation.id,
      imageId: operation.imageId,
      chapterId: operation.chapterId,
      status: "uploaded",
    });
    expect(target.authorization.check).toHaveBeenCalledWith({
      context,
      chapterId: operation.chapterId,
      permission: "images.replace",
    });
    expect(target.transfer.verify).toHaveBeenCalledWith({
      key: operation.candidateStorageKey,
    });
    expect(target.operations.markUploaded).toHaveBeenCalledWith(
      operation.id,
      queuedAt,
    );
    expect(target.operations.tryBeginCompletion).not.toHaveBeenCalled();
    expect(target.operations.markCompleted).not.toHaveBeenCalled();
  });

  it.each(["uploaded", "completing", "completed"] as const)(
    "returns a stable queued projection for %s operations",
    async (status) => {
      const target = subject({ operation: { ...operation, status } });

      await expect(execute(target.service)).resolves.toEqual({
        replacementId: operation.id,
        imageId: operation.imageId,
        chapterId: operation.chapterId,
        status,
      });
      expect(target.transfer.verify).not.toHaveBeenCalled();
      expect(target.operations.markUploaded).not.toHaveBeenCalled();
    },
  );

  it("rejects a failed operation without re-enqueueing it", async () => {
    const target = subject({ operation: { ...operation, status: "failed" } });

    await expect(execute(target.service)).rejects.toBeInstanceOf(
      ImageReplacementCompletionFailedError,
    );
    expect(target.transfer.verify).not.toHaveBeenCalled();
    expect(target.operations.markUploaded).not.toHaveBeenCalled();
  });

  it("rejects missing, mismatched, and unauthorized operations", async () => {
    await expect(
      execute(subject({ operation: null }).service),
    ).rejects.toBeInstanceOf(ImageReplacementCompletionNotFoundError);
    for (const scoped of [
      { ...operation, chapterId: "chapter-other" },
      { ...operation, imageId: "image-other" },
    ]) {
      const target = subject({ operation: scoped });
      await expect(execute(target.service)).rejects.toBeInstanceOf(
        ImageReplacementCompletionNotFoundError,
      );
      expect(target.transfer.verify).not.toHaveBeenCalled();
    }
    const denied = subject({ allowed: false });
    await expect(execute(denied.service)).rejects.toBeInstanceOf(
      ImageReplacementCompletionDeniedError,
    );
    expect(denied.transfer.verify).not.toHaveBeenCalled();
  });

  it("does not enqueue when candidate verification fails or mismatches", async () => {
    const missing = subject();
    vi.mocked(missing.transfer.verify).mockRejectedValue(
      new UploadTransferObjectNotFoundError(),
    );
    await expect(execute(missing.service)).rejects.toBeInstanceOf(
      ImageReplacementCompletionNotFoundError,
    );
    expect(missing.operations.markUploaded).not.toHaveBeenCalled();

    for (const verified of [
      { ...operation, key: "Media/series/1/other.jpg", etag: "etag" },
      {
        key: operation.candidateStorageKey,
        sizeBytes: operation.sizeBytes + 1,
        contentType: operation.contentType,
        etag: "etag",
      },
      {
        key: operation.candidateStorageKey,
        sizeBytes: operation.sizeBytes,
        contentType: "image/png",
        etag: "etag",
      },
      {
        key: operation.candidateStorageKey,
        sizeBytes: operation.sizeBytes,
        contentType: operation.contentType,
      },
    ]) {
      const mismatch = subject({ verified });
      await expect(execute(mismatch.service)).rejects.toBeInstanceOf(
        ImageReplacementCompletionInvalidError,
      );
      expect(mismatch.operations.markUploaded).not.toHaveBeenCalled();
    }
  });
});
