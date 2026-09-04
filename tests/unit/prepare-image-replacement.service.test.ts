import { describe, expect, it, vi } from "vitest";
import {
  ImageReplacementPrepareDeniedError,
  ImageReplacementPrepareInvalidError,
  ImageReplacementPrepareNotFoundError,
  PrepareImageReplacementService,
} from "../../apps/api/src/modules/images/application/services/prepare-image-replacement.service.js";

const image = {
  id: "image-1",
  chapterId: "chapter-1",
  filename: "00.jpg",
  storageKey: "Media/series/1/00.jpg",
  extension: "jpg",
  contentType: "image/jpeg",
  sizeBytes: 1,
  sortOrder: 0,
  checksum: "sum",
  warnings: [],
  createdAt: new Date(),
  updatedAt: new Date(),
};
const context = { userId: "user-1" } as never;

function subject(options?: {
  allowed?: boolean;
  chapterId?: string;
  max?: number;
}) {
  const create = vi.fn(async (input) => ({
    ...input,
    resultImageVersionId: null,
    lastErrorCode: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    completedAt: null,
  }));
  const service = new PrepareImageReplacementService(
    {
      findById: vi.fn(async () => ({
        ...image,
        chapterId: options?.chapterId ?? image.chapterId,
      })),
      listByChapterId: vi.fn(),
    },
    {
      check: vi.fn(async () => ({
        allowed: options?.allowed ?? true,
        reason: "ok",
      })),
    },
    {
      create,
      findById: vi.fn(),
      markUploaded: vi.fn(),
      tryBeginCompletion: vi.fn(),
      markCompleted: vi.fn(),
      markFailed: vi.fn(),
    },
    options?.max ?? 100,
  );
  return { service, create };
}

describe("PrepareImageReplacementService", () => {
  it("prepares supported images with server-owned distinct operations", async () => {
    const { service, create } = subject();
    const first = await service.execute({
      context,
      chapterId: "chapter-1",
      imageId: "image-1",
      filename: "next.jpg",
      contentType: "image/jpeg",
      sizeBytes: 10,
    });
    const second = await service.execute({
      context,
      chapterId: "chapter-1",
      imageId: "image-1",
      filename: "next.png",
      contentType: "image/png",
      sizeBytes: 10,
    });
    expect(first.replacementId).not.toBe(second.replacementId);
    expect(first.candidateStorageKey).not.toBe(second.candidateStorageKey);
    expect(first.candidateStorageKey).toContain(first.replacementId);
    expect(first.candidateStorageKey).toMatch(/^Media\/series\/1\//);
    expect(first.candidateStorageKey).not.toMatch(/_v\d+(?:\.|$)/);
    expect(create).toHaveBeenCalledTimes(2);
    expect(create.mock.calls[0]?.[0]).toMatchObject({
      status: "pending_upload",
    });
  });

  it.each([
    ["image/png", "next.png"],
    ["image/webp", "next.webp"],
    ["image/gif", "next.gif"],
  ])("accepts %s", async (contentType, filename) => {
    const { service } = subject();
    await expect(
      service.execute({
        context,
        chapterId: "chapter-1",
        imageId: "image-1",
        filename,
        contentType,
        sizeBytes: 10,
      }),
    ).resolves.toBeDefined();
  });

  it.each(["application/zip", "application/x-zip-compressed", "image/avif"])(
    "rejects %s without persistence",
    async (contentType) => {
      const { service, create } = subject();
      await expect(
        service.execute({
          context,
          chapterId: "chapter-1",
          imageId: "image-1",
          filename: "next.zip",
          contentType,
          sizeBytes: 10,
        }),
      ).rejects.toBeInstanceOf(ImageReplacementPrepareInvalidError);
      expect(create).not.toHaveBeenCalled();
    },
  );

  it("rejects authorization, scope, and invalid sizes before persistence", async () => {
    const denied = subject({ allowed: false });
    await expect(
      denied.service.execute({
        context,
        chapterId: "chapter-1",
        imageId: "image-1",
        filename: "next.jpg",
        contentType: "image/jpeg",
        sizeBytes: 10,
      }),
    ).rejects.toBeInstanceOf(ImageReplacementPrepareDeniedError);
    expect(denied.create).not.toHaveBeenCalled();
    const wrong = subject({ chapterId: "other" });
    await expect(
      wrong.service.execute({
        context,
        chapterId: "chapter-1",
        imageId: "image-1",
        filename: "next.jpg",
        contentType: "image/jpeg",
        sizeBytes: 10,
      }),
    ).rejects.toBeInstanceOf(ImageReplacementPrepareNotFoundError);
    for (const sizeBytes of [0, -1, 1.5, Number.MAX_SAFE_INTEGER + 1, 101]) {
      const invalid = subject();
      await expect(
        invalid.service.execute({
          context,
          chapterId: "chapter-1",
          imageId: "image-1",
          filename: "next.jpg",
          contentType: "image/jpeg",
          sizeBytes,
        }),
      ).rejects.toBeInstanceOf(ImageReplacementPrepareInvalidError);
      expect(invalid.create).not.toHaveBeenCalled();
    }
  });
});
