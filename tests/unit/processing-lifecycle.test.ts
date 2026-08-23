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
      createdBy: "user-1",
      status: "uploaded",
      storageKey: input.sourceStorageKey,
    }),
    claimChapter: vi.fn().mockResolvedValue(true),
    replaceImagesAndMarkReady: vi.fn().mockResolvedValue(undefined),
    markFailed: vi.fn().mockResolvedValue(undefined),
    deleteImages: vi.fn().mockResolvedValue(undefined),
  };
  const storage: StoragePort = {
    put: vi.fn().mockResolvedValue({
      key: "Media/series-1/chapter-1/01.jpg",
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
    expect(deps.repository.claimChapter).toHaveBeenCalledWith("chapter-1");
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
    expect(retry.repository.markFailed).toHaveBeenCalledOnce();
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
    expect(final.storage.delete).toHaveBeenCalledWith(input.sourceStorageKey);
  });
});
