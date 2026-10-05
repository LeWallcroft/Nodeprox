import { createHash } from "node:crypto";
import { Readable } from "node:stream";
import { describe, expect, it, vi } from "vitest";
import { ChapterProcessingService } from "../../apps/worker/src/processing/application/chapter-processing.service.js";
import type {
  ProcessingAuditPort,
  ProcessingRepositoryPort,
  ZipExtractorPort,
} from "../../apps/worker/src/processing/application/ports.js";
import {
  StorageObjectAlreadyExistsError,
  type StoragePort,
} from "@nodeprox/storage/port";
import { legacyStorageProfileId } from "../helpers/storage-execution.js";
import type { StorageExecutionResolver } from "@nodeprox/storage/profile-execution";

const input = {
  chapterId: "chapter-1",
  seriesId: "series-1",
  uploadId: "upload-1",
  sourceStorageKey: "uploads/series-1/chapter-1/upload-1.zip",
};

function setup() {
  const repository: ProcessingRepositoryPort = {
    loadLatestAcceptedManifest: vi.fn().mockResolvedValue([
      {
        filename: "01.jpg",
        extension: "jpg",
        contentType: "image/jpeg",
        sortOrder: 1,
        sizeBytes: 3,
        checksumSha256: createHash("sha256").update("img").digest("hex"),
        warnings: [],
      },
    ]),
    findUpload: vi.fn().mockResolvedValue({
      ...input,
      seriesPublicSlug: "prueba1",
      chapterPublicKey: "6",
      createdBy: "user-1",
      status: "uploaded",
      chapterStatus: "uploaded",
      storageKey: input.sourceStorageKey,
      storageProfileId: legacyStorageProfileId,
    }),
    claimChapter: vi.fn().mockResolvedValue({
      outcome: "claimed",
      attempt: {
        id: "attempt-1",
        storageProfileId: legacyStorageProfileId,
        chapterId: input.chapterId,
        uploadId: input.uploadId,
        jobId: null,
        jobAttempt: null,
        attemptNumber: 1,
        status: "processing",
        errorCode: null,
        errorMessage: null,
        startedAt: new Date(0),
        finishedAt: null,
      },
    }),
    reserveCandidate: vi.fn().mockResolvedValue(undefined),
    markCandidate: vi.fn().mockResolvedValue(undefined),
    replaceImagesAndMarkReady: vi.fn().mockResolvedValue(undefined),
    markFailed: vi.fn().mockResolvedValue(undefined),
  };
  const storage: StoragePort & StorageExecutionResolver = {
    storageFor: async (profileId) => {
      if (profileId !== legacyStorageProfileId)
        throw new Error("unexpected-profile");
      return storage;
    },
    uploadTransferFor: async () => {
      throw new Error("unexpected-transfer");
    },
    put: vi.fn().mockResolvedValue({
      key: "Media/prueba1/6/01.jpg",
      sizeBytes: 3,
      contentType: "image/jpeg",
    }),
    get: vi
      .fn()
      .mockImplementation((key: string) =>
        Promise.resolve(
          Readable.from([
            Buffer.from(key.startsWith("Media/") ? "img" : "zip"),
          ]),
        ),
      ),
    exists: vi.fn().mockResolvedValue(true),
    delete: vi.fn().mockResolvedValue(undefined),
  };
  const extractor: ZipExtractorPort = {
    inspect: vi.fn().mockResolvedValue([
      {
        filename: "01.jpg",
        extension: "jpg",
        contentType: "image/jpeg",
        sortOrder: 1,
        sizeBytes: 3,
        checksum: createHash("sha256").update("img").digest("hex"),
        warnings: [],
        tempPath: "temporary",
      },
    ]),
    readImage: vi.fn().mockReturnValue(Readable.from([Buffer.from("img")])),
    replayableImage: vi.fn().mockReturnValue({
      sizeBytes: 3,
      open: () => Readable.from([Buffer.from("img")]),
    }),
    dispose: vi.fn().mockResolvedValue(undefined),
  };
  const audit: ProcessingAuditPort = {
    append: vi.fn().mockResolvedValue(undefined),
  };
  return { repository, storage, extractor, audit };
}

describe("ChapterProcessingService lifecycle", () => {
  it("uses the persisted B profile for the source, candidate, publication and cleanup", async () => {
    const profileB = "11111111-1111-4111-8111-111111111111";
    const deps = setup();
    const originalUpload = await deps.repository.findUpload(input.uploadId);
    if (!originalUpload) throw new Error("missing-upload-fixture");
    vi.mocked(deps.repository.findUpload).mockResolvedValueOnce({
      ...originalUpload,
      storageProfileId: profileB,
    });
    const profileBStorage = setup().storage;
    const resolver = {
      storageFor: vi.fn(async (id: string) =>
        id === profileB ? profileBStorage : deps.storage,
      ),
      uploadTransferFor: async () => {
        throw new Error("unused");
      },
    };
    await new ChapterProcessingService(
      deps.repository,
      resolver,
      deps.extractor,
      deps.audit,
    ).process(input);
    expect(resolver.storageFor).toHaveBeenCalledWith(profileB);
    expect(profileBStorage.put).toHaveBeenCalledOnce();
    expect(profileBStorage.delete).not.toHaveBeenCalledWith(
      input.sourceStorageKey,
    );
    expect(deps.storage.put).not.toHaveBeenCalled();
    expect(deps.repository.replaceImagesAndMarkReady).toHaveBeenCalledWith(
      input.chapterId,
      input.uploadId,
      "attempt-1",
      "user-1",
      [expect.objectContaining({ storageProfileId: profileB })],
    );
  });

  it("rejects a storage object whose persisted content type differs", async () => {
    const deps = setup();
    deps.storage.head = vi.fn().mockResolvedValue({
      sizeBytes: 3,
      contentType: "application/octet-stream",
    });
    await expect(
      new ChapterProcessingService(
        deps.repository,
        deps.storage,
        deps.extractor,
        deps.audit,
      ).process(input),
    ).rejects.toThrow("storage-verification-failed");
    expect(deps.repository.replaceImagesAndMarkReady).not.toHaveBeenCalled();
  });

  it("accepts an existing identical object without taking cleanup ownership", async () => {
    const deps = setup();
    vi.mocked(deps.storage.put).mockRejectedValueOnce(
      new StorageObjectAlreadyExistsError(),
    );
    await new ChapterProcessingService(
      deps.repository,
      deps.storage,
      deps.extractor,
      deps.audit,
    ).process(input);
    expect(deps.repository.markCandidate).toHaveBeenCalledWith(
      "attempt-1",
      "Media/prueba1/6/01.jpg",
      "reused",
    );
    expect(deps.storage.delete).not.toHaveBeenCalledWith(
      input.sourceStorageKey,
    );
    expect(deps.storage.delete).not.toHaveBeenCalledWith(
      "Media/prueba1/6/01.jpg",
    );
  });

  it("rejects different content at the same key without deleting published media", async () => {
    const deps = setup();
    vi.mocked(deps.storage.put).mockRejectedValueOnce(
      new StorageObjectAlreadyExistsError(),
    );
    vi.mocked(deps.storage.get).mockImplementation((key: string) =>
      Promise.resolve(
        Readable.from([
          Buffer.from(key.startsWith("Media/") ? "different" : "zip"),
        ]),
      ),
    );
    await expect(
      new ChapterProcessingService(
        deps.repository,
        deps.storage,
        deps.extractor,
        deps.audit,
      ).process(input),
    ).rejects.toThrow("STORAGE_WRITE_KEY_MISMATCH");
    expect(deps.repository.replaceImagesAndMarkReady).not.toHaveBeenCalled();
    expect(deps.repository.markFailed).toHaveBeenCalledWith(
      input.chapterId,
      input.uploadId,
      "attempt-1",
      expect.objectContaining({
        disposition: "terminal",
        errorCode: "STORAGE_WRITE_KEY_MISMATCH",
      }),
      "user-1",
    );
    expect(deps.storage.delete).not.toHaveBeenCalledWith(
      "Media/prueba1/6/01.jpg",
    );
  });

  it("records a created candidate before a DB publication failure and cleans only that key", async () => {
    const deps = setup();
    vi.mocked(deps.repository.replaceImagesAndMarkReady).mockRejectedValueOnce(
      new Error("database-unavailable"),
    );
    await expect(
      new ChapterProcessingService(
        deps.repository,
        deps.storage,
        deps.extractor,
        deps.audit,
      ).process(input),
    ).rejects.toThrow("database-unavailable");
    expect(deps.repository.reserveCandidate).toHaveBeenCalledWith(
      "attempt-1",
      "Media/prueba1/6/01.jpg",
      expect.any(String),
    );
    expect(deps.repository.markCandidate).toHaveBeenCalledWith(
      "attempt-1",
      "Media/prueba1/6/01.jpg",
      "created",
    );
    expect(deps.storage.delete).toHaveBeenCalledWith("Media/prueba1/6/01.jpg");
    expect(deps.repository.markCandidate).toHaveBeenCalledWith(
      "attempt-1",
      "Media/prueba1/6/01.jpg",
      "cleaned",
    );
  });
  it("moves uploaded to ready and defers source cleanup to the outbox", async () => {
    const deps = setup();
    await new ChapterProcessingService(
      deps.repository,
      deps.storage,
      deps.extractor,
      deps.audit,
    ).process(input);
    expect(deps.repository.claimChapter).toHaveBeenCalledWith({
      chapterId: "chapter-1",
      uploadId: "upload-1",
    });
    expect(deps.repository.replaceImagesAndMarkReady).toHaveBeenCalledOnce();
    expect(deps.storage.delete).not.toHaveBeenCalledWith(
      input.sourceStorageKey,
    );
    expect(deps.repository.markFailed).not.toHaveBeenCalled();
  });

  it("keeps the source ZIP for retryable and exhausted failures", async () => {
    const retry = setup();
    vi.mocked(retry.extractor.inspect).mockRejectedValueOnce(
      new Error("temporary"),
    );
    await expect(
      new ChapterProcessingService(
        retry.repository,
        retry.storage,
        retry.extractor,
        retry.audit,
      ).process(input),
    ).rejects.toThrow("temporary");
    expect(retry.repository.markFailed).toHaveBeenCalledWith(
      input.chapterId,
      input.uploadId,
      "attempt-1",
      {
        disposition: "retryable",
        errorCode: "PROCESSING_UNKNOWN",
        errorMessage: "temporary",
      },
      "user-1",
    );
    expect(retry.storage.delete).not.toHaveBeenCalledWith(
      input.sourceStorageKey,
    );

    const final = setup();
    vi.mocked(final.extractor.inspect).mockRejectedValueOnce(
      new Error("permanent"),
    );
    await expect(
      new ChapterProcessingService(
        final.repository,
        final.storage,
        final.extractor,
        final.audit,
      ).process(input, true),
    ).rejects.toThrow("permanent");
    expect(final.repository.markFailed).toHaveBeenCalledWith(
      input.chapterId,
      input.uploadId,
      "attempt-1",
      {
        disposition: "retry_exhausted",
        errorCode: "PROCESSING_UNKNOWN",
        errorMessage: "permanent",
      },
      "user-1",
    );
    expect(final.storage.delete).not.toHaveBeenCalledWith(
      input.sourceStorageKey,
    );
  });

  it("does not publish ready when storage returns inconsistent object metadata", async () => {
    const deps = setup();
    vi.mocked(deps.storage.put).mockResolvedValueOnce({
      key: "Media/prueba1/6/wrong.jpg",
      sizeBytes: 3,
      contentType: "image/jpeg",
    });
    await expect(
      new ChapterProcessingService(
        deps.repository,
        deps.storage,
        deps.extractor,
        deps.audit,
      ).process(input),
    ).rejects.toThrow("STORAGE_WRITE_KEY_MISMATCH");
    expect(deps.repository.replaceImagesAndMarkReady).not.toHaveBeenCalled();
    expect(deps.repository.markFailed).toHaveBeenCalledWith(
      input.chapterId,
      input.uploadId,
      "attempt-1",
      {
        disposition: "terminal",
        errorCode: "STORAGE_WRITE_KEY_MISMATCH",
        errorMessage: "stored-image-metadata-mismatch",
      },
      "user-1",
    );
  });

  it("does not undo a successful publication when completion audit logging fails", async () => {
    const deps = setup();
    vi.mocked(deps.audit.append).mockRejectedValueOnce(
      new Error("audit-temporarily-unavailable"),
    );
    await expect(
      new ChapterProcessingService(
        deps.repository,
        deps.storage,
        deps.extractor,
        deps.audit,
      ).process(input),
    ).resolves.toBeUndefined();
    expect(deps.repository.replaceImagesAndMarkReady).toHaveBeenCalledOnce();
    expect(deps.storage.delete).not.toHaveBeenCalledWith(
      input.sourceStorageKey,
    );
    expect(deps.repository.markFailed).not.toHaveBeenCalled();
  });

  it("treats a re-delivered completed invocation idempotently", async () => {
    const deps = setup();
    vi.mocked(deps.repository.claimChapter).mockResolvedValueOnce({
      outcome: "finished",
      attempt: {
        id: "attempt-1",
        storageProfileId: legacyStorageProfileId,
        chapterId: input.chapterId,
        uploadId: input.uploadId,
        validationRunId: null,
        jobId: "job-1",
        jobAttempt: 1,
        attemptNumber: 1,
        status: "succeeded",
        errorCode: null,
        errorMessage: null,
        startedAt: new Date(0),
        finishedAt: new Date(1),
      },
    });
    await new ChapterProcessingService(
      deps.repository,
      deps.storage,
      deps.extractor,
      deps.audit,
    ).process(input, false, { jobId: "job-1", jobAttempt: 1 });
    expect(deps.repository.claimChapter).toHaveBeenCalledWith({
      chapterId: input.chapterId,
      uploadId: input.uploadId,
      jobId: "job-1",
      jobAttempt: 1,
    });
    expect(deps.extractor.inspect).not.toHaveBeenCalled();
    expect(deps.repository.replaceImagesAndMarkReady).not.toHaveBeenCalled();
  });

  it("keeps ready publication and succeeded attempt intact while cleanup is deferred", async () => {
    const first = setup();
    vi.mocked(first.storage.delete).mockRejectedValueOnce(
      new Error("temporary-source-delete-error"),
    );
    await expect(
      new ChapterProcessingService(
        first.repository,
        first.storage,
        first.extractor,
        first.audit,
      ).process(input),
    ).resolves.toBeUndefined();
    expect(first.repository.replaceImagesAndMarkReady).toHaveBeenCalledOnce();
    expect(first.repository.markFailed).not.toHaveBeenCalled();

    const retry = setup();
    vi.mocked(retry.repository.findUpload).mockResolvedValueOnce({
      ...input,
      seriesPublicSlug: "prueba1",
      chapterPublicKey: "6",
      createdBy: "user-1",
      status: "uploaded",
      chapterStatus: "ready",
      storageKey: input.sourceStorageKey,
      storageProfileId: legacyStorageProfileId,
    });
    await new ChapterProcessingService(
      retry.repository,
      retry.storage,
      retry.extractor,
      retry.audit,
    ).process(input);
    expect(retry.storage.delete).not.toHaveBeenCalledWith(
      input.sourceStorageKey,
    );
    expect(retry.repository.claimChapter).not.toHaveBeenCalled();
    expect(retry.extractor.inspect).not.toHaveBeenCalled();
  });
});
