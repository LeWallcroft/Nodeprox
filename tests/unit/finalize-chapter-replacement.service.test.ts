import { describe, expect, it, vi } from "vitest";
import type { ChapterMediaActivationService } from "../../apps/api/src/modules/chapter-replacements/application/chapter-media-activation.service.js";
import {
  ChapterReplacementDeniedError,
  ChapterReplacementInvariantError,
  FinalizeChapterReplacementService,
} from "../../apps/api/src/modules/chapter-replacements/application/finalize-chapter-replacement.service.js";
import type { ChapterReplacementOperation } from "../../apps/api/src/modules/chapter-replacements/domain/chapter-replacement-operation.js";

const operation = (
  status: ChapterReplacementOperation["status"],
): ChapterReplacementOperation => ({
  id: "replacement-1",
  chapterId: "chapter-1",
  requestedByUserId: "user-1",
  candidateZipStorageKey: "private/source.zip",
  storageProfileId: "00000000-0000-4000-8000-000000000001",
  originalFilename: "chapter.zip",
  contentType: "application/zip",
  sizeBytes: 10,
  etag: null,
  status,
  lastErrorCode: status === "failed" ? "invalid-zip-archive" : null,
  previousImageCount: status === "completed" ? 2 : null,
  resultImageCount: status === "completed" ? 3 : null,
  retainedImageCount: status === "completed" ? 2 : null,
  createdImageCount: status === "completed" ? 1 : null,
  retiredImageCount: status === "completed" ? 0 : null,
  createdAt: new Date(0),
  updatedAt: new Date(0),
  completedAt: status === "completed" ? new Date(1) : null,
});

const result = {
  replacementId: "replacement-1",
  chapterId: "chapter-1",
  previousImageCount: 2,
  imageCount: 3,
  retainedImageCount: 2,
  createdImageCount: 1,
  retiredImageCount: 0,
  completedAt: new Date(1),
};

function fixture(
  status: ChapterReplacementOperation["status"],
  allowed = true,
) {
  const operations = {
    create: vi.fn(),
    findById: vi.fn(),
    findByIdForChapter: vi.fn().mockResolvedValue(operation(status)),
    getCompletedResult: vi
      .fn()
      .mockResolvedValue(status === "completed" ? result : null),
  };
  const activation = { execute: vi.fn().mockResolvedValue(result) };
  const authorization = {
    check: vi
      .fn()
      .mockResolvedValue({ allowed, reason: allowed ? "role" : "denied" }),
  };
  const service = new FinalizeChapterReplacementService(
    operations,
    activation as unknown as ChapterMediaActivationService,
    authorization,
  );
  return { service, operations, activation, authorization };
}

const input = {
  replacementId: "replacement-1",
  chapterId: "chapter-1",
  context: { userId: "user-1", sessionId: "session-1" },
};

describe("FinalizeChapterReplacementService", () => {
  it("CHR4-COORD-01 activates only a ready operation", async () => {
    const target = fixture("ready");
    await expect(target.service.execute(input)).resolves.toMatchObject({
      status: "completed",
      result,
    });
    expect(target.activation.execute).toHaveBeenCalledOnce();
  });

  it.each([
    "pending_upload",
    "uploaded",
    "processing",
    "completing",
    "failed",
  ] as const)("CHR4-COORD-02 does not activate %s", async (status) => {
    const target = fixture(status);
    await expect(target.service.execute(input)).resolves.toMatchObject({
      status,
    });
    expect(target.activation.execute).not.toHaveBeenCalled();
  });

  it("CHR4-COORD-03 returns the immutable completed result", async () => {
    const target = fixture("completed");
    await expect(target.service.execute(input)).resolves.toEqual({
      replacementId: "replacement-1",
      chapterId: "chapter-1",
      status: "completed",
      result,
    });
    expect(target.activation.execute).not.toHaveBeenCalled();
  });

  it("CHR4-COORD-04 authorizes every status observation with chapters.replace", async () => {
    const target = fixture("processing", false);
    await expect(target.service.execute(input)).rejects.toBeInstanceOf(
      ChapterReplacementDeniedError,
    );
    expect(target.authorization.check).toHaveBeenCalledWith({
      context: input.context,
      chapterId: "chapter-1",
      permission: "chapters.replace",
    });
  });

  it("CHR4-COORD-05 rejects invalid completed persistence", async () => {
    const target = fixture("completed");
    target.operations.getCompletedResult.mockResolvedValue(null);
    await expect(target.service.execute(input)).rejects.toBeInstanceOf(
      ChapterReplacementInvariantError,
    );
  });
});
