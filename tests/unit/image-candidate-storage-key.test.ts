import { describe, expect, it } from "vitest";
import { createImageCandidateStorageKey } from "../../apps/api/src/modules/images/domain/image-candidate-storage-key.js";
import { MediaStorageKey } from "../../apps/api/src/modules/images/domain/media-storage-key.js";

describe("createImageCandidateStorageKey", () => {
  it("creates the next immutable version in the public media scope", () => {
    const input = {
      currentStorageKey: "Media/raven/1-5/00_v7.jpg",
      logicalFilename: "00.jpg",
      nextVersion: 8,
      contentType: "image/jpeg",
    };
    const first = createImageCandidateStorageKey(input);

    expect(first).toBe("Media/raven/1-5/00_v8.jpg");
  });

  it("keeps the logical filename while accepting a replacement extension", () => {
    const first = createImageCandidateStorageKey({
      currentStorageKey: "Media/raven/1-5/00.jpg",
      logicalFilename: "00.jpg",
      nextVersion: 2,
      contentType: "image/webp",
    });

    expect(MediaStorageKey.parseExisting(first)).toMatchObject({
      seriesSlug: "raven",
      chapterPublicKey: "1-5",
      extension: "webp",
    });
    expect(first).toBe("Media/raven/1-5/00_v2.webp");
  });
});
