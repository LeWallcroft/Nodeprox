import { describe, expect, it } from "vitest";
import {
  InvalidUploadError,
  UploadTooLargeError,
  isSupportedZipMimeType,
  validateUploadMetadata,
} from "../../apps/api/src/modules/uploads/domain/upload.policy.js";

const valid = {
  filename: "chapter.zip",
  contentType: "application/zip",
  sizeBytes: 10,
  maxSizeBytes: 100,
  magicBytes: Uint8Array.from([0x50, 0x4b, 0x03, 0x04]),
};

describe("chapter upload policy", () => {
  it("accepts only the supported ZIP transport MIME types", () => {
    expect(isSupportedZipMimeType("application/zip")).toBe(true);
    expect(isSupportedZipMimeType("application/x-zip-compressed")).toBe(true);
    expect(isSupportedZipMimeType("image/jpeg")).toBe(false);
    expect(isSupportedZipMimeType("image/png")).toBe(false);
    expect(isSupportedZipMimeType("application/pdf")).toBe(false);
    expect(isSupportedZipMimeType("application/x-msdownload")).toBe(false);
  });

  it("accepts a valid ZIP and rejects invalid metadata", () => {
    expect(validateUploadMetadata(valid).filename).toBe("chapter.zip");
    expect(
      validateUploadMetadata({
        ...valid,
        contentType: "application/x-zip-compressed",
      }).filename,
    ).toBe("chapter.zip");
    expect(() =>
      validateUploadMetadata({ ...valid, filename: "chapter.exe" }),
    ).toThrow(InvalidUploadError);
    expect(() =>
      validateUploadMetadata({
        ...valid,
        contentType: "application/octet-stream",
      }),
    ).toThrow(InvalidUploadError);
    expect(() =>
      validateUploadMetadata({
        ...valid,
        magicBytes: Uint8Array.from([0, 0, 0, 0]),
      }),
    ).toThrow(InvalidUploadError);
    expect(() => validateUploadMetadata({ ...valid, sizeBytes: 101 })).toThrow(
      UploadTooLargeError,
    );
    expect(() =>
      validateUploadMetadata({
        ...valid,
        sizeBytes: 536870913,
        maxSizeBytes: 536870912,
      }),
    ).toThrow(UploadTooLargeError);
  });
});
