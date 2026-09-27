import { Readable } from "node:stream";
import { describe, expect, it } from "vitest";
import type { StoragePort } from "@nodeprox/storage/port";
import { ImageQueryService } from "../../apps/api/src/modules/images/application/services/image-query.service.js";
import {
  legacyStorageExecution,
  legacyStorageProfileId,
} from "../helpers/storage-execution.js";

const image = {
  id: "image-1",
  chapterId: "chapter-1",
  filename: "01.jpg",
  storageKey: "Media/series-1/chapter-1/01.jpg",
  storageProfileId: legacyStorageProfileId,
  extension: "jpg",
  contentType: "image/jpeg",
  sizeBytes: 3,
  sortOrder: 1,
  checksum: "checksum",
  warnings: [],
  createdAt: new Date("2026-01-01T00:00:00.000Z"),
  updatedAt: new Date("2026-01-01T00:00:00.000Z"),
};

function storageFake(): StoragePort {
  return {
    put: async (input) => ({
      key: input.key,
      sizeBytes: input.sizeBytes,
      contentType: input.contentType,
    }),
    get: async () => Readable.from([Buffer.from("img")]),
    delete: async () => undefined,
    exists: async () => true,
  };
}

describe("ImageQueryService", () => {
  it("reads the current version from its pinned profile when keys collide", async () => {
    const profileB = "11111111-1111-4111-8111-111111111111";
    const first = storageFake();
    const second = storageFake();
    second.get = async () => Readable.from([Buffer.from("profile-b")]);
    const service = new ImageQueryService(
      {
        listByChapterId: async () => [],
        findById: async () => ({ ...image, storageProfileId: profileB }),
      },
      {
        check: async () => ({
          allowed: true,
          reason: "assigned",
          seriesId: "series",
        }),
      },
      {
        storageFor: async (id) => (id === profileB ? second : first),
        uploadTransferFor: async () => {
          throw new Error("unused");
        },
      },
    );
    const content = await service.getContent(
      { userId: "user-1", sessionId: "session-1" },
      "image-1",
    );
    expect(await content.stream.toArray()).toEqual([Buffer.from("profile-b")]);
  });

  it("lists ordered metadata without exposing storage keys", async () => {
    const service = new ImageQueryService(
      {
        listByChapterId: async () => [image],
        findById: async () => image,
      },
      {
        check: async () => ({
          allowed: true,
          reason: "assigned",
          seriesId: "series",
        }),
      },
      legacyStorageExecution(storageFake()),
    );

    const result = await service.list(
      { userId: "user-1", sessionId: "session-1" },
      "chapter-1",
    );

    expect(result).toEqual(
      [{ ...image, storageKey: undefined }].map(
        ({
          storageKey: _storageKey,
          storageProfileId: _storageProfileId,
          ...value
        }) => value,
      ),
    );
    expect(result[0]).not.toHaveProperty("storageKey");
    expect(result[0]).not.toHaveProperty("storageProfileId");
  });

  it("rejects an unauthorized image and uses StoragePort for content", async () => {
    const storage = storageFake();
    const service = new ImageQueryService(
      { listByChapterId: async () => [], findById: async () => image },
      { check: async () => ({ allowed: false, reason: "denied" }) },
      legacyStorageExecution(storage),
    );

    await expect(
      service.getMetadata(
        { userId: "other", sessionId: "session-2" },
        "image-1",
      ),
    ).rejects.toThrow("image-access-denied");

    const authorized = new ImageQueryService(
      { listByChapterId: async () => [], findById: async () => image },
      {
        check: async () => ({
          allowed: true,
          reason: "assigned",
          seriesId: "series",
        }),
      },
      legacyStorageExecution(storage),
    );
    const content = await authorized.getContent(
      { userId: "user-1", sessionId: "session-1" },
      "image-1",
    );
    expect(await content.stream.toArray()).toEqual([Buffer.from("img")]);
  });
});
