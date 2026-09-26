import { Readable } from "node:stream";
import { describe, expect, it, vi } from "vitest";
import { ChapterProcessingService } from "../../apps/worker/src/processing/application/chapter-processing.service.js";
import type {
  ProcessingAuditPort,
  ProcessingRepositoryPort,
  ZipExtractorPort,
} from "../../apps/worker/src/processing/application/ports.js";
import type { StoragePort } from "../../packages/storage/src/port.js";

const input = {
  chapterId: "chapter-1",
  seriesId: "series-1",
  uploadId: "upload-1",
  sourceStorageKey: "uploads/series-1/chapter-1/upload-1.zip",
};

function setup() {
  const repository: ProcessingRepositoryPort = {
    findUpload: vi.fn().mockResolvedValue({
      ...input,
      seriesPublicSlug: "prueba1",
      chapterPublicKey: "6",
      createdBy: "user-1",
      status: "uploaded",
      chapterStatus: "uploaded",
      storageKey: input.sourceStorageKey,
    }),
    claimChapter: vi.fn().mockResolvedValue({
      outcome: "claimed",
      attempt: {
        id: "attempt-1",
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
    replaceImagesAndMarkReady: vi.fn().mockResolvedValue(undefined),
    markFailed: vi.fn().mockResolvedValue(undefined),
  };
  const storage: StoragePort = {
    put: vi.fn().mockResolvedValue({
      key: "Media/prueba1/6/01.jpg",
      sizeBytes: 3,
      contentType: "image/jpeg",
    }),
    get: vi.fn().mockResolvedValue(Readable.from([Buffer.from("zip")])),
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
        checksum: "checksum",
        warnings: [],
        tempPath: "temporary",
      },
    ]),
    readImage: vi.fn().mockReturnValue(Readable.from([Buffer.from("img")])),
    dispose: vi.fn().mockResolvedValue(undefined),
  };
  const audit: ProcessingAuditPort = {
    append: vi.fn().mockResolvedValue(undefined),
  };
  return { repository, storage, extractor, audit };
}

describe("ChapterProcessingService lifecycle", () => {
  it("moves uploaded to ready and removes the temporary ZIP", async () => {
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
    expect(deps.storage.delete).toHaveBeenCalledWith(input.sourceStorageKey);
    expect(deps.repository.markFailed).not.toHaveBeenCalled();
  });

  it("keeps the source ZIP for a retryable failure and cleans it on final failure", async () => {
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
        terminal: false,
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
        terminal: true,
        errorCode: "PROCESSING_UNKNOWN",
        errorMessage: "permanent",
      },
      "user-1",
    );
    expect(final.storage.delete).toHaveBeenCalledWith(input.sourceStorageKey);
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
    ).rejects.toThrow("stored-image-metadata-mismatch");
    expect(deps.repository.replaceImagesAndMarkReady).not.toHaveBeenCalled();
    expect(deps.repository.markFailed).toHaveBeenCalledWith(
      input.chapterId,
      input.uploadId,
      "attempt-1",
      {
        terminal: true,
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
    expect(deps.storage.delete).toHaveBeenCalledWith(input.sourceStorageKey);
    expect(deps.repository.markFailed).not.toHaveBeenCalled();
  });

  it("treats a re-delivered completed invocation idempotently", async () => {
    const deps = setup();
    vi.mocked(deps.repository.claimChapter).mockResolvedValueOnce({
      outcome: "finished",
      attempt: {
        id: "attempt-1",
        chapterId: input.chapterId,
        uploadId: input.uploadId,
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

  it("keeps ready publication and succeeded attempt intact when source cleanup fails", async () => {
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
    });
    await new ChapterProcessingService(
      retry.repository,
      retry.storage,
      retry.extractor,
      retry.audit,
    ).process(input);
    expect(retry.storage.delete).toHaveBeenCalledWith(input.sourceStorageKey);
    expect(retry.repository.claimChapter).not.toHaveBeenCalled();
    expect(retry.extractor.inspect).not.toHaveBeenCalled();
  });
});
