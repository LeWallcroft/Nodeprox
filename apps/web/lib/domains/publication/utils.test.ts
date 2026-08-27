import { describe, expect, it } from "vitest";
import { publicImageUrlsText, sortPublicImages } from "./utils";

const images = [
  {
    id: "3",
    filename: "three.webp",
    extension: "webp",
    contentType: "image/webp",
    sizeBytes: 3,
    sortOrder: 3,
    url: "url3",
  },
  {
    id: "1",
    filename: "one.webp",
    extension: "webp",
    contentType: "image/webp",
    sizeBytes: 1,
    sortOrder: 1,
    url: "url1",
  },
  {
    id: "2",
    filename: "two.webp",
    extension: "webp",
    contentType: "image/webp",
    sizeBytes: 2,
    sortOrder: 2,
    url: "url2",
  },
];

describe("public chapter manifest helpers", () => {
  it("orders images by numeric sortOrder", () => {
    expect(sortPublicImages(images).map((image) => image.sortOrder)).toEqual([
      1, 2, 3,
    ]);
  });

  it("creates the exact newline-delimited Copy All value", () => {
    expect(publicImageUrlsText(images)).toBe("url1\nurl2\nurl3");
  });
});
