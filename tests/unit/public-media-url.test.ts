import { describe, expect, it } from "vitest";
import { PublicMediaUrl } from "../../apps/api/src/modules/images/domain/public-media-url.js";

const image = {
  seriesPublicSlug: "raven",
  chapterPublicKey: "25",
  filename: "01.png",
  contentType: "image/png",
};

describe("PublicMediaUrl", () => {
  it("builds the canonical URL with or without a trailing slash", () => {
    const expected = "https://media.nodeprox.org/raven/25/01.png";
    expect(
      PublicMediaUrl.fromImage("https://media.nodeprox.org", image).toString(),
    ).toBe(expected);
    expect(
      PublicMediaUrl.fromImage("https://media.nodeprox.org/", image).toString(),
    ).toBe(expected);
  });

  it("rejects invalid identities, extensions, and mismatched metadata", () => {
    expect(() =>
      PublicMediaUrl.fromImage("https://media.nodeprox.org", {
        ...image,
        seriesPublicSlug: "Not Stable",
      }),
    ).toThrow();
    expect(() =>
      PublicMediaUrl.fromImage("https://media.nodeprox.org", {
        ...image,
        filename: "01.exe",
      }),
    ).toThrow();
    expect(() =>
      PublicMediaUrl.fromImage("https://media.nodeprox.org", {
        ...image,
        contentType: "image/jpeg",
      }),
    ).toThrow();
  });

  it("does not contain storage internals", () => {
    const value = PublicMediaUrl.fromImage(
      "https://media.nodeprox.org",
      image,
    ).toString();
    expect(value).not.toContain("storageKey");
    expect(value).not.toMatch(/[0-9a-f]{8}-[0-9a-f-]{27}/i);
    expect(value).not.toContain("backblazeb2.com");
    expect(value).not.toContain("B2");
  });

  it("projects opaque and historical version-shaped physical filenames", () => {
    expect(
      PublicMediaUrl.fromImage("https://media.nodeprox.org", {
        ...image,
        filename: "7d4f02e8-2df2-47a0-a8bd-a46938aa2fab.png",
      }).toString(),
    ).toBe(
      "https://media.nodeprox.org/raven/25/7d4f02e8-2df2-47a0-a8bd-a46938aa2fab.png",
    );
    expect(
      PublicMediaUrl.fromImage("https://media.nodeprox.org", {
        ...image,
        filename: "01_v2.png",
      }).toString(),
    ).toBe("https://media.nodeprox.org/raven/25/01_v2.png");
  });
});
