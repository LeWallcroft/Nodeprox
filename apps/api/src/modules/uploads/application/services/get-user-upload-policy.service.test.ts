import { describe, expect, it } from "vitest";
import { GetUserUploadPolicyService } from "./get-user-upload-policy.service.js";

function createService(settings: ReadonlyMap<string, number>) {
  return new GetUserUploadPolicyService(
    { readNumbers: async () => settings },
    {
      maxUploadBytes: 512 * 1024 * 1024,
      maxEntries: 1000,
      maxExpandedBytes: 512 * 1024 * 1024,
      maxImageBytes: 32 * 1024 * 1024,
      maxHeightPx: 15000,
    },
  );
}

describe("GetUserUploadPolicyService", () => {
  it("projects effective limits, separate warnings, formats and concurrency", async () => {
    const policy = await createService(
      new Map([
        ["upload_max_image_size_mb", 64],
        ["upload_max_height_px", 0],
        ["upload_warning_height_px", 12000],
        ["bulk_upload_concurrency", 5],
      ]),
    ).execute();

    expect(policy).toEqual({
      zip: {
        maxUploadBytes: 512 * 1024 * 1024,
        maxEntries: 1000,
        maxExpandedBytes: 512 * 1024 * 1024,
        layouts: ["flat", "single-wrapper"],
      },
      images: {
        allowedExtensions: ["jpg", "jpeg", "png", "webp", "gif"],
        filenameRule: "two-digit-sequence",
        maxImageBytes: 32 * 1024 * 1024,
        maxWidthPx: null,
        maxHeightPx: 15000,
        maxPixels: null,
        maxCompressionRatio: null,
      },
      warnings: {
        imageBytes: 8 * 1024 * 1024,
        widthPx: 4000,
        heightPx: 12000,
      },
      transfer: { maxConcurrentUploads: 3 },
    });
  });

  it.each([
    [2, 2],
    [5, 3],
    [undefined, 3],
  ] as const)(
    "caps browser concurrency %s to effective value %s",
    async (configured, expected) => {
      const settings = new Map<string, number>();
      if (configured !== undefined)
        settings.set("bulk_upload_concurrency", configured);
      await expect(createService(settings).execute()).resolves.toMatchObject({
        transfer: { maxConcurrentUploads: expected },
      });
    },
  );

  it("returns only the user policy contract without infrastructure settings", async () => {
    const response = JSON.stringify(await createService(new Map()).execute());
    for (const forbidden of [
      "B2",
      "bucket",
      "redis",
      "token",
      "applicationKey",
      "profileId",
      "DATABASE_URL",
      "REDIS_URL",
      "system_config",
    ])
      expect(response.toLowerCase()).not.toContain(forbidden.toLowerCase());
    expect(Object.keys(JSON.parse(response))).toEqual([
      "zip",
      "images",
      "warnings",
      "transfer",
    ]);
  });
});
