import { describe, expect, it, vi } from "vitest";
import type { MediaReplacementTransactionPort } from "../../apps/api/src/modules/images/application/media-replacement.ports.js";
import { ActivateImageCandidateService } from "../../apps/api/src/modules/images/application/services/activate-image-candidate.service.js";
import { createImageCandidateStorageKey } from "../../apps/api/src/modules/images/domain/image-candidate-storage-key.js";

function subject(version = 1) {
  const cutover = vi.fn(
    async (
      _input: Parameters<MediaReplacementTransactionPort["cutover"]>[0],
    ) => ({
      versionId: `version-${version + 1}`,
    }),
  );
  const completeReplacementOperation = vi.fn(async () => undefined);
  const repository = {
    withLockedImage: vi.fn(async (_id, work) =>
      work({
        image: {
          id: "image-1",
          chapterId: "chapter-1",
          seriesSlug: "series",
          chapterPublicKey: "1",
          logicalFilename: "00.jpg",
          current: {
            id: `version-${version}`,
            version,
            physicalFilename: version === 1 ? "00.jpg" : `00_v${version}.jpg`,
            storageKey: `Media/series/1/${version === 1 ? "00.jpg" : `00_v${version}.jpg`}`,
            extension: "jpg",
            contentType: "image/jpeg",
            sizeBytes: 10,
            checksum: "old",
          },
        },
        cutover,
        completeReplacementOperation,
      }),
    ),
    findCandidateContext: vi.fn(),
    enqueueOrphanCleanup: vi.fn(),
  };
  const candidateStorageKey = createImageCandidateStorageKey({
    currentStorageKey: `Media/series/1/${version === 1 ? "00.jpg" : `00_v${version}.jpg`}`,
    logicalFilename: "00.jpg",
    nextVersion: version + 1,
    contentType: "image/jpeg",
  });
  return {
    service: new ActivateImageCandidateService(
      repository,
      "https://media.example",
    ),
    candidateStorageKey,
    cutover,
    completeReplacementOperation,
    repository,
  };
}

describe("ActivateImageCandidateService", () => {
  it("activates an already-stored candidate through one CASE8 cutover", async () => {
    const { service, candidateStorageKey, cutover } = subject();
    const result = await service.execute({
      context: { userId: "user-1" } as never,
      imageId: "image-1",
      candidateStorageKey,
      contentType: "image/jpeg",
      sizeBytes: 20,
      checksum: "new",
      operationId: "op-1",
    });
    expect(result).toMatchObject({
      imageId: "image-1",
      versionId: "version-2",
      version: 2,
    });
    expect(cutover).toHaveBeenCalledOnce();
    expect(cutover.mock.calls[0]?.[0]).toMatchObject({
      operationId: "op-1",
      actorId: "user-1",
      next: {
        version: 2,
        storageKey: candidateStorageKey,
        physicalFilename: candidateStorageKey.split("/").at(-1),
      },
      oldPublicUrl: "https://media.example/series/1/00.jpg",
    });
  });

  it("completes a durable operation inside the activation transaction", async () => {
    const {
      service,
      candidateStorageKey,
      cutover,
      completeReplacementOperation,
    } = subject();
    const completedAt = new Date("2026-09-03T23:00:00.000Z");

    await service.execute({
      context: { userId: "user-1" } as never,
      imageId: "image-1",
      candidateStorageKey,
      contentType: "image/jpeg",
      sizeBytes: 20,
      checksum: "new",
      operationId: "op-1",
      durableCompletion: { completedAt },
    });

    expect(cutover).toHaveBeenCalledOnce();
    expect(completeReplacementOperation).toHaveBeenCalledWith({
      operationId: "op-1",
      imageId: "image-1",
      actorId: "user-1",
      resultImageVersionId: "version-2",
      completedAt,
    });
  });

  it("allocates sequential versions without external storage actions", async () => {
    const first = subject(1);
    const second = subject(2);
    await first.service.execute({
      context: { userId: "user-1" } as never,
      imageId: "image-1",
      candidateStorageKey: first.candidateStorageKey,
      contentType: "image/jpeg",
      sizeBytes: 20,
      checksum: "new",
      operationId: "op-1",
    });
    const result = await second.service.execute({
      context: { userId: "user-1" } as never,
      imageId: "image-1",
      candidateStorageKey: second.candidateStorageKey,
      contentType: "image/jpeg",
      sizeBytes: 20,
      checksum: "new",
      operationId: "op-2",
    });
    expect(result.version).toBe(3);
    expect(first.candidateStorageKey).not.toBe(second.candidateStorageKey);
    expect(first.candidateStorageKey).toMatch(/_v2(?:\.|$)/);
    expect(second.candidateStorageKey).toMatch(/_v3(?:\.|$)/);
    expect(first.repository).not.toHaveProperty("put");
    expect(first.repository).not.toHaveProperty("verify");
  });
});
