import { describe, expect, it } from "vitest";
import { PublicMediaUrl } from "../../apps/api/src/modules/images/domain/public-media-url.js";

const image = {
  id: "11111111-1111-4111-8111-111111111111",
  seriesId: "22222222-2222-4222-8222-222222222222",
  chapterId: "33333333-3333-4333-8333-333333333333",
  extension: "png",
  contentType: "image/png",
};

describe("PublicMediaUrl", () => {
  it("builds the canonical URL with or without a trailing slash", () => {
    const expected =
      "https://media.nodeprox.org/series/22222222-2222-4222-8222-222222222222/chapters/33333333-3333-4333-8333-333333333333/images/11111111-1111-4111-8111-111111111111.png";
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
        id: "not-a-uuid",
      }),
    ).toThrow();
    expect(() =>
      PublicMediaUrl.fromImage("https://media.nodeprox.org", {
        ...image,
        extension: "exe",
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
    expect(value).not.toContain("backblazeb2.com");
    expect(value).not.toContain("B2");
  });
});
