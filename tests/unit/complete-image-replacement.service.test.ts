import { describe, expect, it, vi } from "vitest";
import type {
  ImageReplacementOperation,
  ImageReplacementOperationRepository,
} from "../../apps/api/src/modules/images/application/image-replacement-operation.repository.js";
import type { ImageVersionResultRepository } from "../../apps/api/src/modules/images/application/image-version-result.repository.js";
import {
  CompleteImageReplacementService,
  ImageReplacementCompletionDeniedError,
  ImageReplacementCompletionFailedError,
  ImageReplacementCompletionInProgressError,
  ImageReplacementCompletionInvalidError,
  ImageReplacementCompletionInvariantError,
  ImageReplacementCompletionNotFoundError,
} from "../../apps/api/src/modules/images/application/services/complete-image-replacement.service.js";
import {
  UploadTransferObjectNotFoundError,
  type UploadTransferPort,
} from "../../packages/storage/dist/port.js";

const context = { userId: "user-1" } as never;
const completedAt = new Date("2026-09-03T23:30:00.000Z");
const operation: ImageReplacementOperation = {
  id: "operation-1",
  imageId: "image-1",
  chapterId: "chapter-1",
  requestedByUserId: "user-1",
  candidateStorageKey: "Media/series/1/opaque.jpg",
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
const activated = {
  imageId: operation.imageId,
  versionId: "version-2",
  version: 2,
  filename: "opaque.jpg",
  storageKey: operation.candidateStorageKey,
  publicUrl: "https://media.example/series/1/opaque.jpg",
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
  const completing = initial
    ? { ...initial, status: "completing" as const }
    : null;
  const operations: ImageReplacementOperationRepository = {
    create: vi.fn(),
    findById: vi.fn(async () => initial),
    markUploaded: vi.fn(async () => uploaded),
    tryBeginCompletion: vi.fn(async () => ({
      acquired: true,
      operation: completing,
    })),
    markCompleted: vi.fn(),
    markFailed: vi.fn(),
  };
  const versions: ImageVersionResultRepository = {
    findVersionResultById: vi.fn(async () => activated),
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
  const activator = { execute: vi.fn(async () => activated) };
  const authorization = {
    check: vi.fn(async () => ({
      allowed: input?.allowed ?? true,
      reason: "role",
    })),
  };
  const service = new CompleteImageReplacementService(
    operations,
    versions,
    transfer,
    activator,
    authorization,
    () => completedAt,
  );
  return {
    service,
    operations,
    versions,
    transfer,
    activator,
    authorization,
  };
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
  it("verifies, claims, and invokes atomic durable activation", async () => {
    const target = subject();

    await expect(execute(target.service)).resolves.toEqual(activated);
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
      completedAt,
    );
    expect(target.operations.tryBeginCompletion).toHaveBeenCalledWith(
      operation.id,
      completedAt,
    );
    expect(target.activator.execute).toHaveBeenCalledOnce();
    expect(target.activator.execute).toHaveBeenCalledWith({
      context,
      imageId: operation.imageId,
      candidateStorageKey: operation.candidateStorageKey,
      contentType: operation.contentType,
      sizeBytes: operation.sizeBytes,
      checksum: "candidate-etag",
      operationId: operation.id,
      requestId: "request-1",
      durableCompletion: { completedAt },
    });
    expect(target.operations.markCompleted).not.toHaveBeenCalled();
  });

  it("returns an immutable historical result for an already-completed operation", async () => {
    const historical = { ...activated, versionId: "version-2", version: 2 };
    const target = subject({
      operation: {
        ...operation,
        status: "completed",
        resultImageVersionId: historical.versionId,
        completedAt,
      },
    });
    vi.mocked(target.versions.findVersionResultById).mockResolvedValue(
      historical,
    );

    await expect(execute(target.service)).resolves.toEqual(historical);
    expect(target.versions.findVersionResultById).toHaveBeenCalledWith(
      historical.versionId,
    );
    expect(target.transfer.verify).not.toHaveBeenCalled();
    expect(target.operations.tryBeginCompletion).not.toHaveBeenCalled();
    expect(target.activator.execute).not.toHaveBeenCalled();
  });

  it.each([
    [
      { ...operation, status: "completed" as const },
      ImageReplacementCompletionInvariantError,
    ],
    [
      { ...operation, status: "completing" as const },
      ImageReplacementCompletionInProgressError,
    ],
    [
      { ...operation, status: "failed" as const },
      ImageReplacementCompletionFailedError,
    ],
  ])("rejects invalid or unavailable operation state", async (state, error) => {
    await expect(
      execute(subject({ operation: state }).service),
    ).rejects.toBeInstanceOf(error);
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

  it("does not activate when candidate verification fails or mismatches", async () => {
    const missing = subject();
    vi.mocked(missing.transfer.verify).mockRejectedValue(
      new UploadTransferObjectNotFoundError(),
    );
    await expect(execute(missing.service)).rejects.toBeInstanceOf(
      UploadTransferObjectNotFoundError,
    );
    expect(missing.activator.execute).not.toHaveBeenCalled();

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
      expect(mismatch.activator.execute).not.toHaveBeenCalled();
    }
  });

  it("lets only one concurrent caller acquire activation ownership", async () => {
    const target = subject();
    let claims = 0;
    vi.mocked(target.operations.tryBeginCompletion).mockImplementation(
      async () => {
        claims += 1;
        return {
          acquired: claims === 1,
          operation: { ...operation, status: "completing" },
        };
      },
    );

    const results = await Promise.allSettled([
      execute(target.service),
      execute(target.service),
    ]);

    expect(target.activator.execute).toHaveBeenCalledOnce();
    expect(
      results.filter((result) => result.status === "fulfilled"),
    ).toHaveLength(1);
    const rejected = results.find((result) => result.status === "rejected");
    expect(rejected).toMatchObject({
      status: "rejected",
      reason: expect.any(ImageReplacementCompletionInProgressError),
    });
  });

  it("rehydrates a completed loser instead of activating again", async () => {
    const completed = {
      ...operation,
      status: "completed" as const,
      resultImageVersionId: activated.versionId,
      completedAt,
    };
    const target = subject();
    vi.mocked(target.operations.tryBeginCompletion).mockResolvedValue({
      acquired: false,
      operation: completed,
    });

    await expect(execute(target.service)).resolves.toEqual(activated);
    expect(target.versions.findVersionResultById).toHaveBeenCalledWith(
      activated.versionId,
    );
    expect(target.activator.execute).not.toHaveBeenCalled();
  });
});
