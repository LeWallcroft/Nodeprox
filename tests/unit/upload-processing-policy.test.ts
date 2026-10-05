import { describe, expect, it } from "vitest";
import {
  buildUploadProcessingPolicy,
  minDefined,
} from "../../apps/worker/src/admission-validation/domain/upload-processing-policy.js";

describe("minDefined", () => {
  it.each([
    [undefined, undefined, undefined],
    [5, undefined, 5],
    [undefined, 20000, 20000],
    [12000, 10000, 10000],
    [5, 64, 5],
    [64, 32, 32],
  ])(
    "returns the stricter defined value",
    (product, infrastructure, expected) => {
      expect(minDefined(product, infrastructure)).toBe(expected);
    },
  );
});

describe("buildUploadProcessingPolicy", () => {
  const infrastructure = { maxImageBytes: 64 * 1024 * 1024, maxWidthPx: 20000 };
  it("uses the stricter product image size and infrastructure ceilings", () => {
    expect(
      buildUploadProcessingPolicy(
        new Map([["upload_max_image_size_mb", 5]]),
        infrastructure,
      ).admission.maxImageBytes,
    ).toBe(5 * 1024 * 1024);
    expect(
      buildUploadProcessingPolicy(new Map([["upload_max_image_size_mb", 64]]), {
        ...infrastructure,
        maxImageBytes: 32 * 1024 * 1024,
      }).admission.maxImageBytes,
    ).toBe(32 * 1024 * 1024);
  });

  it("keeps product zero disabled while retaining an infrastructure ceiling", () => {
    expect(
      buildUploadProcessingPolicy(new Map([["upload_max_width_px", 0]]), {
        maxImageBytes: 64 * 1024 * 1024,
      }).admission.maxWidthPx,
    ).toBeUndefined();
    expect(
      buildUploadProcessingPolicy(
        new Map([["upload_max_width_px", 0]]),
        infrastructure,
      ).admission.maxWidthPx,
    ).toBe(20000);
    expect(
      buildUploadProcessingPolicy(new Map([["upload_max_width_px", 12000]]), {
        ...infrastructure,
        maxWidthPx: 10000,
      }).admission.maxWidthPx,
    ).toBe(10000);
  });
});
