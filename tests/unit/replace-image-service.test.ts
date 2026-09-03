import { Readable } from "node:stream";
import { describe, expect, it, vi } from "vitest";
import { ReplaceImageService } from "../../apps/api/src/modules/images/application/services/replace-image.service.js";
import type {
  MediaReplacementRepositoryPort,
  MediaReplacementTransactionPort,
} from "../../apps/api/src/modules/images/application/media-replacement.ports.js";
import type { StoragePort } from "../../packages/storage/src/port.js";

const context = {
  userId: "11111111-1111-4111-8111-111111111111",
  sessionId: "22222222-2222-4222-8222-222222222222",
};
const imageId = "33333333-3333-4333-8333-333333333333";

function transaction(version = 1): MediaReplacementTransactionPort {
  return {
    image: {
      id: imageId,
      chapterId: "44444444-4444-4444-8444-444444444444",
      seriesSlug: "raven",
      chapterPublicKey: "1-5",
      logicalFilename: "00.jpg",
      current: {
        id: "55555555-5555-4555-8555-555555555555",
        version,
        physicalFilename: version === 1 ? "00.jpg" : `00_v${version}.jpg`,
        storageKey: `Media/raven/1-5/${version === 1 ? "00.jpg" : `00_v${version}.jpg`}`,
        extension: "jpg",
        contentType: "image/jpeg",
        sizeBytes: 10,
        checksum: "old-checksum",
      },
    },
    cutover: vi.fn(async () => ({
      versionId: "66666666-6666-4666-8666-666666666666",
    })),
  };
}

function repository(
  tx: MediaReplacementTransactionPort,
): MediaReplacementRepositoryPort {
  return {
    findChapterId: vi.fn(async () => tx.image.chapterId),
    withLockedImage: vi.fn(async (_id, work) => work(tx)),
    enqueueOrphanCleanup: vi.fn(async () => undefined),
  };
}

function storage(overrides: Partial<StoragePort> = {}): StoragePort {
  return {
    put: vi.fn(async (input) => ({
      key: input.key,
      sizeBytes: input.sizeBytes,
      contentType: input.contentType,
    })),
    get: vi.fn(async () => Readable.from([])),
    delete: vi.fn(async () => undefined),
    exists: vi.fn(async () => true),
    ...overrides,
  };
}

function service(
  repo: MediaReplacementRepositoryPort,
  objectStorage: StoragePort,
) {
  return new ReplaceImageService(
    repo,
    { check: vi.fn(async () => ({ allowed: true, reason: "role" })) },
    objectStorage,
    "https://media.nodeprox.org",
    { orphanCandidate: vi.fn() },
  );
}

function input() {
  return {
    context,
    imageId,
    body: Readable.from([Buffer.alloc(20)]),
    contentType: "image/jpeg",
    sizeBytes: 20,
    checksum: "new-checksum",
    requestId: "req-media-1",
  };
}

describe("ReplaceImageService", () => {
  it.each([
    [1, 2, "00_v2.jpg"],
    [2, 3, "00_v3.jpg"],
  ])(
    "cuts over v%d to v%d while preserving image identity",
    async (from, to, filename) => {
      const tx = transaction(from);
      const repo = repository(tx);
      const objectStorage = storage();
      const result = await service(repo, objectStorage).execute(input());

      expect(result).toMatchObject({ imageId, version: to, filename });
      expect(tx.cutover).toHaveBeenCalledWith(
        expect.objectContaining({
          oldPublicUrl: `https://media.nodeprox.org/raven/1-5/${from === 1 ? "00.jpg" : `00_v${from}.jpg`}`,
          next: expect.objectContaining({
            version: to,
            physicalFilename: filename,
            storageKey: `Media/raven/1-5/${filename}`,
          }),
        }),
      );
      expect(objectStorage.delete).not.toHaveBeenCalled();
    },
  );

  it("does not cut over or delete the canonical object when the new put fails", async () => {
    const tx = transaction();
    const objectStorage = storage({
      put: vi.fn(async () => {
        throw new Error("b2-unavailable");
      }),
    });
    await expect(
      service(repository(tx), objectStorage).execute(input()),
    ).rejects.toThrow("b2-unavailable");
    expect(tx.cutover).not.toHaveBeenCalled();
    expect(objectStorage.delete).not.toHaveBeenCalled();
  });

  it("deletes the new orphan candidate when DB cutover fails", async () => {
    const tx = transaction();
    vi.mocked(tx.cutover).mockRejectedValue(new Error("db-cutover-failed"));
    const objectStorage = storage();
    await expect(
      service(repository(tx), objectStorage).execute(input()),
    ).rejects.toThrow("db-cutover-failed");
    expect(objectStorage.delete).toHaveBeenCalledWith(
      "Media/raven/1-5/00_v2.jpg",
    );
    expect(objectStorage.delete).not.toHaveBeenCalledWith(
      "Media/raven/1-5/00.jpg",
    );
  });

  it("persists durable orphan cleanup when immediate compensation fails", async () => {
    const tx = transaction();
    vi.mocked(tx.cutover).mockRejectedValue(new Error("db-cutover-failed"));
    const repo = repository(tx);
    const objectStorage = storage({
      delete: vi.fn(async () => {
        throw new Error("delete-unavailable");
      }),
    });
    await expect(service(repo, objectStorage).execute(input())).rejects.toThrow(
      "db-cutover-failed",
    );
    expect(repo.enqueueOrphanCleanup).toHaveBeenCalledWith(
      expect.objectContaining({
        imageId,
        storageKey: "Media/raven/1-5/00_v2.jpg",
      }),
    );
  });
});
