import { describe, expect, it, vi } from "vitest";
import {
  ChapterTargetRaceError,
  ChapterTargetResolver,
} from "../../apps/api/src/modules/ingestion/application/chapter-target.resolver.js";
import type {
  ImportChapterCreatePort,
  ImportChapterLookupPort,
  ImportChapterTarget,
} from "../../apps/api/src/modules/ingestion/application/ports.js";

const actor = { userId: "actor-1", sessionId: "session-1" };

function target(
  mutation: Partial<ImportChapterTarget> = {},
): ImportChapterTarget {
  return {
    chapterId: "chapter-1",
    status: "draft",
    hasActiveUpload: false,
    hasUpload: false,
    hasMedia: false,
    ...mutation,
  };
}

function resolver(
  findTarget: ImportChapterLookupPort["findTarget"],
  create: ImportChapterCreatePort["create"] = async () => ({
    outcome: "created",
    chapterId: "created-chapter",
  }),
) {
  return new ChapterTargetResolver({ findTarget }, { create });
}

describe("ChapterTargetResolver", () => {
  it("creates an absent Chapter using its canonical decimal identity", async () => {
    const findTarget = vi.fn(async () => null);
    const create = vi.fn(async () => ({
      outcome: "created" as const,
      chapterId: "created-chapter",
    }));

    await expect(
      resolver(findTarget, create).resolve({
        actor,
        seriesId: "series-1",
        chapterNumber: 1.5,
      }),
    ).resolves.toEqual({ kind: "created", chapterId: "created-chapter" });
    expect(create).toHaveBeenCalledWith({
      actor,
      seriesId: "series-1",
      chapterNumber: 1.5,
    });
  });

  it.each([0, 1.5])("reuses an eligible draft Chapter %s", async (number) => {
    const findTarget = vi.fn(async () => target());
    await expect(
      resolver(findTarget).resolve({
        actor,
        seriesId: "series-1",
        chapterNumber: number,
      }),
    ).resolves.toEqual({ kind: "reused", chapterId: "chapter-1" });
  });

  it.each([
    [target({ hasActiveUpload: true }), "chapter-upload-active"],
    [target({ status: "uploading" }), "chapter-upload-active"],
    [target({ status: "uploaded", hasUpload: true }), "chapter-uploaded"],
    [target({ status: "processing", hasUpload: true }), "chapter-processing"],
    [target({ status: "ready", hasUpload: true }), "chapter-ready"],
    [target({ status: "failed", hasUpload: true }), "chapter-failed"],
    [target({ status: "deleting" }), "chapter-deleting"],
    [target({ hasMedia: true }), "chapter-media-exists"],
    [target({ hasUpload: true }), "chapter-uploaded"],
  ] as const)("maps an incompatible target to %s", async (snapshot, reason) => {
    await expect(
      resolver(async () => snapshot).resolve({
        actor,
        seriesId: "series-1",
        chapterNumber: 1,
      }),
    ).resolves.toEqual({
      kind: "conflict",
      chapterId: "chapter-1",
      reason,
    });
  });

  it("reuses only the known failed Chapter during retry", async () => {
    const failed = target({ status: "failed", hasUpload: true });
    await expect(
      resolver(async () => failed).resolve({
        actor,
        seriesId: "series-1",
        chapterNumber: 1,
        retryChapterId: failed.chapterId,
      }),
    ).resolves.toEqual({ kind: "reused", chapterId: failed.chapterId });
    await expect(
      resolver(async () => failed).resolve({
        actor,
        seriesId: "series-1",
        chapterNumber: 1,
        retryChapterId: "different-chapter",
      }),
    ).resolves.toEqual({
      kind: "conflict",
      chapterId: failed.chapterId,
      reason: "chapter-failed",
    });
  });

  it("rereads exactly once after losing the create race", async () => {
    const findTarget = vi
      .fn<ImportChapterLookupPort["findTarget"]>()
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(target());
    const create = vi.fn(async () => ({ outcome: "conflict" as const }));

    await expect(
      resolver(findTarget, create).resolve({
        actor,
        seriesId: "series-1",
        chapterNumber: 1.5,
      }),
    ).resolves.toEqual({ kind: "reused", chapterId: "chapter-1" });
    expect(findTarget).toHaveBeenCalledTimes(2);
    expect(create).toHaveBeenCalledTimes(1);
  });

  it("returns the reread lifecycle conflict after losing the create race", async () => {
    const findTarget = vi
      .fn<ImportChapterLookupPort["findTarget"]>()
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(target({ status: "uploading" }));

    await expect(
      resolver(findTarget, async () => ({ outcome: "conflict" })).resolve({
        actor,
        seriesId: "series-1",
        chapterNumber: 1.5,
      }),
    ).resolves.toEqual({
      kind: "conflict",
      chapterId: "chapter-1",
      reason: "chapter-upload-active",
    });
  });

  it("does not loop when a create conflict cannot be reread", async () => {
    const findTarget = vi.fn(async () => null);
    await expect(
      resolver(findTarget, async () => ({ outcome: "conflict" })).resolve({
        actor,
        seriesId: "series-1",
        chapterNumber: 1,
      }),
    ).rejects.toBeInstanceOf(ChapterTargetRaceError);
    expect(findTarget).toHaveBeenCalledTimes(2);
  });
});
