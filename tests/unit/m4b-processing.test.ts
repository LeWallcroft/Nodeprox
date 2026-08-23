import { describe, expect, it } from "vitest";
import {
  contentTypeForMagic,
  permanentImageKey,
  validateImageName,
} from "../../apps/worker/src/processing/domain/image-policy.js";

describe("M4-B image policy", () => {
  it("validates names, magic bytes and permanent keys", () => {
    expect(validateImageName("01.jpg")).toEqual({
      extension: "jpg",
      sortOrder: 1,
    });
    expect(
      contentTypeForMagic(
        "png",
        Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
      ),
    ).toBe("image/png");
    expect(permanentImageKey("series", "chapter", "01.jpg")).toBe(
      "Media/series/chapter/01.jpg",
    );
    expect(() => validateImageName("../01.jpg")).toThrow(
      "invalid-image-filename",
    );
    expect(() => validateImageName("page.jpg")).toThrow(
      "invalid-image-filename",
    );
    expect(() =>
      contentTypeForMagic("jpg", Uint8Array.from([0, 0, 0, 0])),
    ).toThrow("image-magic-mismatch");
  });

  it("supports mixed image formats and rejects ambiguous ordering", () => {
    expect(
      contentTypeForMagic(
        "gif",
        Uint8Array.from([0x47, 0x49, 0x46, 0x38, 0x39, 0x61]),
      ),
    ).toBe("image/gif");
    expect(
      contentTypeForMagic(
        "webp",
        Uint8Array.from([
          0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, 0x57, 0x45, 0x42, 0x50,
        ]),
      ),
    ).toBe("image/webp");
    expect(() => validateImageName("001.jpg")).toThrow(
      "invalid-image-filename",
    );
  });
});
