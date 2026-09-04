import { describe, expect, it } from "vitest";
import { createImageCandidateStorageKey } from "../../apps/api/src/modules/images/domain/image-candidate-storage-key.js";
import { MediaStorageKey } from "../../apps/api/src/modules/images/domain/media-storage-key.js";

describe("createImageCandidateStorageKey", () => {
  it("creates distinct opaque keys in the current final media scope", () => {
    const input = {
      replacementId: "replacement-1",
      currentStorageKey: "Media/raven/1-5/00_v7.jpg",
      contentType: "image/jpeg",
    };
    const first = createImageCandidateStorageKey(input);
    const second = createImageCandidateStorageKey(input);

    expect(first).toMatch(/^Media\/raven\/1-5\/replacement-1-[0-9a-f-]+\.jpg$/);
    expect(second).not.toBe(first);
    expect(first).not.toMatch(/_v8(?:\.|$)/);
    expect(first).not.toContain("replacement-candidates/");
  });

  it("does not depend on the historical filename or logical version", () => {
    const first = createImageCandidateStorageKey({
      replacementId: "replacement-1",
      currentStorageKey: "Media/raven/1-5/00.jpg",
      contentType: "image/webp",
    });
    const second = createImageCandidateStorageKey({
      replacementId: "replacement-2",
      currentStorageKey: "Media/raven/1-5/00_v99.jpg",
      contentType: "image/webp",
    });

    expect(MediaStorageKey.parseExisting(first)).toMatchObject({
      seriesSlug: "raven",
      chapterPublicKey: "1-5",
      extension: "webp",
    });
    expect(MediaStorageKey.parseExisting(second)).toMatchObject({
      seriesSlug: "raven",
      chapterPublicKey: "1-5",
      extension: "webp",
    });
    expect(first).not.toContain("00");
    expect(second).not.toContain("99");
  });
});
