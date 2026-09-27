import { describe, expect, it, vi } from "vitest";
import {
  ChapterMediaActivationService,
  ChapterReplacementActivationConflictError,
  ChapterReplacementActivationDeniedError,
  ChapterReplacementActivationInvariantError,
} from "../../apps/api/src/modules/chapter-replacements/application/chapter-media-activation.service.js";
import type { ChapterReplacementOperation } from "../../apps/api/src/modules/chapter-replacements/domain/chapter-replacement-operation.js";

const context = { userId: "actor", sessionId: "session" };
const completedAt = new Date("2026-09-04T12:00:00.000Z");
const result = {
  replacementId: "replacement",
  chapterId: "chapter",
  previousImageCount: 2,
  imageCount: 2,
  retainedImageCount: 2,
  createdImageCount: 0,
  retiredImageCount: 0,
  completedAt,
};

function operation(
  status: ChapterReplacementOperation["status"],
): ChapterReplacementOperation {
  return {
    id: "replacement",
    chapterId: "chapter",
    requestedByUserId: "actor",
    candidateZipStorageKey: "replacement.zip",
    storageProfileId: "00000000-0000-4000-8000-000000000001",
    originalFilename: "chapter.zip",
    contentType: "application/zip",
    sizeBytes: 100,
    etag: null,
    status,
    lastErrorCode: null,
    previousImageCount: status === "completed" ? 2 : null,
    resultImageCount: status === "completed" ? 2 : null,
    retainedImageCount: status === "completed" ? 2 : null,
    createdImageCount: status === "completed" ? 0 : null,
    retiredImageCount: status === "completed" ? 0 : null,
    createdAt: completedAt,
    updatedAt: completedAt,
    completedAt: status === "completed" ? completedAt : null,
  };
}

function target(status: ChapterReplacementOperation["status"] = "ready") {
  const operations = {
    create: vi.fn(),
    findById: vi.fn(),
    findByIdForChapter: vi.fn().mockResolvedValue(operation(status)),
    getCompletedResult: vi.fn().mockResolvedValue(result),
  };
  const repository = {
    activate: vi
      .fn()
      .mockResolvedValue({ outcome: "completed", result } as const),
  };
  const permissions = {
    check: vi.fn().mockResolvedValue({ allowed: true, reason: "role" }),
  };
  return {
    service: new ChapterMediaActivationService(
      operations,
      repository,
      permissions,
    ),
    operations,
    repository,
    permissions,
  };
}

const execute = (service: ChapterMediaActivationService) =>
  service.execute({
    replacementId: "replacement",
    chapterId: "chapter",
    context,
  });

describe("ChapterMediaActivationService", () => {
  it("authorizes with chapters.replace", async () => {
    const value = target();
    await execute(value.service);
    expect(value.permissions.check).toHaveBeenCalledWith({
      context,
      chapterId: "chapter",
      permission: "chapters.replace",
    });
  });

  it("delegates one ready activation", async () => {
    const value = target();
    await expect(execute(value.service)).resolves.toEqual(result);
    expect(value.repository.activate).toHaveBeenCalledOnce();
  });

  it("returns persisted completed result without activating", async () => {
    const value = target("completed");
    await expect(execute(value.service)).resolves.toEqual(result);
    expect(value.operations.getCompletedResult).toHaveBeenCalledWith(
      "replacement",
    );
    expect(value.repository.activate).not.toHaveBeenCalled();
  });

  it("rejects authorization denial", async () => {
    const value = target();
    value.permissions.check.mockResolvedValue({
      allowed: false,
      reason: "denied",
    });
    await expect(execute(value.service)).rejects.toBeInstanceOf(
      ChapterReplacementActivationDeniedError,
    );
    expect(value.repository.activate).not.toHaveBeenCalled();
  });

  it("rejects invalid lifecycle and completed invariants", async () => {
    const conflict = target("processing");
    await expect(execute(conflict.service)).rejects.toBeInstanceOf(
      ChapterReplacementActivationConflictError,
    );
    const invalid = target("completed");
    invalid.operations.getCompletedResult.mockResolvedValue(null);
    await expect(execute(invalid.service)).rejects.toBeInstanceOf(
      ChapterReplacementActivationInvariantError,
    );
  });
});
