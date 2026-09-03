import { describe, expect, it } from "vitest";
import { MediaStorageKey } from "../../apps/api/src/modules/images/domain/media-storage-key.js";
import { MediaVersion } from "../../apps/api/src/modules/images/domain/media-version.js";

describe("MediaVersion and MediaStorageKey", () => {
  it("creates positive monotonic versions", () => {
    const initial = MediaVersion.initial();
    expect(initial.toNumber()).toBe(1);
    expect(initial.next().toNumber()).toBe(2);
    expect(initial.equals(MediaVersion.parse(1))).toBe(true);
    for (const invalid of [0, -1, 1.5, Number.MAX_SAFE_INTEGER + 1])
      expect(() => MediaVersion.parse(invalid)).toThrow();
  });

  it.each([
    ["00.jpg", 1, "00.jpg"],
    ["00.jpg", 2, "00_v2.jpg"],
    ["00.jpg", 3, "00_v3.jpg"],
    ["page.final.jpg", 2, "page.final_v2.jpg"],
  ])("builds %s version %d as %s", (filename, version, expected) => {
    expect(
      MediaStorageKey.forVersion({
        seriesSlug: "raven",
        chapterPublicKey: "1-5",
        logicalFilename: filename,
        version: MediaVersion.parse(version),
      }),
    ).toEqual({
      physicalFilename: expected,
      storageKey: `Media/raven/1-5/${expected}`,
    });
  });
});
