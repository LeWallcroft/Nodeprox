import { Readable } from "node:stream";
import { describe, expect, it, vi } from "vitest";
import type {
  MediaReplacementRepositoryPort,
  MediaReplacementTransactionPort,
} from "../../apps/api/src/modules/images/application/media-replacement.ports.js";
import { ReplaceImageService } from "../../apps/api/src/modules/images/application/services/replace-image.service.js";
import type { StoragePort } from "@nodeprox/storage/port";
import {
  legacyActiveProfile,
  legacyStorageExecution,
  legacyStorageProfileId,
} from "../helpers/storage-execution.js";

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
        storageProfileId: legacyStorageProfileId,
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
    completeReplacementOperation: vi.fn(async () => undefined),
  };
}

function repository(
  tx: MediaReplacementTransactionPort,
): MediaReplacementRepositoryPort {
  return {
    findCandidateContext: vi.fn(async () => ({
      chapterId: tx.image.chapterId,
      currentStorageKey: tx.image.current.storageKey,
      currentContentType: tx.image.current.contentType,
      currentVersion: tx.image.current.version,
      logicalFilename: tx.image.logicalFilename,
    })),
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
  activator?: ConstructorParameters<typeof ReplaceImageService>[6],
) {
  return new ReplaceImageService(
    repo,
    { check: vi.fn(async () => ({ allowed: true, reason: "role" })) },
    legacyStorageExecution(objectStorage),
    legacyActiveProfile,
    "https://media.nodeprox.org",
    { orphanCandidate: vi.fn() },
    activator,
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
    [1, 2],
    [2, 3],
  ])(
    "cuts over v%d to v%d while preserving image identity",
    async (from, to) => {
      const tx = transaction(from);
      const repo = repository(tx);
      const objectStorage = storage();
      const result = await service(repo, objectStorage).execute(input());

      expect(result).toMatchObject({ imageId, version: to });
      expect(result.filename).toBe(`00_v${to}.jpg`);
      expect(result.publicUrl).toBe(
        `https://media.nodeprox.org/raven/1-5/${result.filename}`,
      );
      expect(tx.cutover).toHaveBeenCalledWith(
        expect.objectContaining({
          oldPublicUrl: `https://media.nodeprox.org/raven/1-5/${from === 1 ? "00.jpg" : `00_v${from}.jpg`}`,
          next: expect.objectContaining({
            version: to,
            physicalFilename: result.filename,
            storageKey: `Media/raven/1-5/${result.filename}`,
          }),
        }),
      );
      expect(objectStorage.put).toHaveBeenCalledOnce();
      expect(objectStorage.put).toHaveBeenCalledWith(
        expect.objectContaining({
          key: `Media/raven/1-5/${result.filename}`,
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
    const repo = repository(tx);
    const activator = { execute: vi.fn() };
    await expect(
      service(repo, objectStorage, activator).execute(input()),
    ).rejects.toThrow("b2-unavailable");
    expect(tx.cutover).not.toHaveBeenCalled();
    expect(repo.withLockedImage).not.toHaveBeenCalled();
    expect(activator.execute).not.toHaveBeenCalled();
    expect(objectStorage.delete).not.toHaveBeenCalled();
  });

  it("puts the final-compatible candidate before activation", async () => {
    const tx = transaction();
    const repo = repository(tx);
    const order: string[] = [];
    const objectStorage = storage({
      put: vi.fn(async (storedInput) => {
        order.push("put");
        return {
          key: storedInput.key,
          sizeBytes: storedInput.sizeBytes,
          contentType: storedInput.contentType,
        };
      }),
    });
    const expected = {
      imageId,
      versionId: "version-2",
      version: 2,
      filename: "00_v2.jpg",
      storageKey: "Media/raven/1-5/00_v2.jpg",
      publicUrl: "https://media.nodeprox.org/raven/1-5/00_v2.jpg",
    };
    const activator = {
      execute: vi.fn(async () => {
        order.push("activate");
        return expected;
      }),
    };

    await expect(
      service(repo, objectStorage, activator).execute(input()),
    ).resolves.toEqual(expected);
    expect(order).toEqual(["put", "activate"]);
    expect(objectStorage.put).toHaveBeenCalledOnce();
    expect(activator.execute).toHaveBeenCalledOnce();
    const putKey = vi.mocked(objectStorage.put).mock.calls[0]?.[0].key;
    expect(putKey).toMatch(/^Media\/raven\/1-5\//);
    expect(putKey).toBe("Media/raven/1-5/00_v2.jpg");
    expect(activator.execute).toHaveBeenCalledWith(
      expect.objectContaining({
        candidateStorageKey: putKey,
        contentType: "image/jpeg",
        sizeBytes: 20,
      }),
    );
  });

  it("completes storage put before entering the image activation lock", async () => {
    const tx = transaction();
    const order: string[] = [];
    const originalCutover = tx.cutover;
    tx.cutover = vi.fn(async (cutoverInput) => {
      order.push("cutover");
      return originalCutover(cutoverInput);
    });
    const repo = repository(tx);
    repo.withLockedImage = vi.fn(async (_id, work) => {
      order.push("lock");
      return work(tx);
    });
    const objectStorage = storage({
      put: vi.fn(async (storedInput) => {
        order.push("put");
        return {
          key: storedInput.key,
          sizeBytes: storedInput.sizeBytes,
          contentType: storedInput.contentType,
        };
      }),
    });

    await service(repo, objectStorage).execute(input());

    expect(order).toEqual(["put", "lock", "cutover"]);
    expect(objectStorage.put).toHaveBeenCalledOnce();
    expect(repo.withLockedImage).toHaveBeenCalledOnce();
    expect(tx.cutover).toHaveBeenCalledOnce();
  });

  it("deletes the new orphan candidate when DB cutover fails", async () => {
    const tx = transaction();
    vi.mocked(tx.cutover).mockRejectedValue(new Error("db-cutover-failed"));
    const objectStorage = storage();
    await expect(
      service(repository(tx), objectStorage).execute(input()),
    ).rejects.toThrow("db-cutover-failed");
    const orphanKey = vi.mocked(objectStorage.delete).mock.calls[0]?.[0];
    expect(orphanKey).toMatch(/^Media\/raven\/1-5\//);
    expect(orphanKey).toBe("Media/raven/1-5/00_v2.jpg");
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
    const cleanup = vi.mocked(repo.enqueueOrphanCleanup).mock.calls[0]?.[0];
    expect(cleanup).toMatchObject({ imageId });
    expect(cleanup?.storageKey).toMatch(/^Media\/raven\/1-5\//);
    expect(cleanup?.storageKey).toBe("Media/raven/1-5/00_v2.jpg");
  });
});
