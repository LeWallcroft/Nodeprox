import { describe, expect, it } from "vitest";
import {
  InvalidUploadError,
  UploadTooLargeError,
  validateUploadMetadata,
} from "../../apps/api/src/modules/uploads/domain/upload.policy.js";

const valid = {
  filename: "chapter.zip",
  contentType: "application/zip",
  sizeBytes: 10,
  maxSizeBytes: 100,
};

describe("chapter upload policy", () => {
  it("accepts a valid ZIP and rejects invalid metadata", () => {
    expect(validateUploadMetadata(valid).filename).toBe("chapter.zip");
    expect(() =>
      validateUploadMetadata({ ...valid, filename: "chapter.exe" }),
    ).toThrow(InvalidUploadError);
    expect(() =>
      validateUploadMetadata({
        ...valid,
        contentType: "application/octet-stream",
      }),
    ).toThrow(InvalidUploadError);
    expect(() => validateUploadMetadata({ ...valid, sizeBytes: 0 })).toThrow(
      InvalidUploadError,
    );
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
