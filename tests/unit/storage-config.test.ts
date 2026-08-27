import { describe, expect, it } from "vitest";
import { loadStorageConfig } from "@nodeprox/config";

const base = {
  UPLOAD_MAX_SIZE_BYTES: "536870912",
};

describe("storage configuration", () => {
  it("uses filesystem outside production", () => {
    expect(loadStorageConfig({ ...base, NODE_ENV: "test" })).toEqual({
      provider: "filesystem",
      uploadMaxSizeBytes: 536870912,
      uploadPendingTtlSeconds: 86400,
    });
  });

  it("requires every B2 value in production", () => {
    expect(() =>
      loadStorageConfig({ ...base, NODE_ENV: "production" }),
    ).toThrow();
    expect(() =>
      loadStorageConfig({
        ...base,
        NODE_ENV: "production",
        B2_ENDPOINT: "not-a-url",
        B2_REGION: "us-west-004",
        B2_BUCKET: "bucket",
        B2_KEY_ID: "key",
        B2_APPLICATION_KEY: "secret",
      }),
    ).toThrow();
    expect(
      loadStorageConfig({
        ...base,
        NODE_ENV: "production",
        B2_ENDPOINT: "https://s3.us-west-004.backblazeb2.com",
        B2_REGION: "us-west-004",
        B2_BUCKET: "bucket",
        B2_KEY_ID: "key",
        B2_APPLICATION_KEY: "secret",
      }),
    ).toMatchObject({ provider: "b2", uploadMaxSizeBytes: 536870912 });
  });

  it("supports explicit B2 direct upload in local development", () => {
    expect(
      loadStorageConfig({
        ...base,
        NODE_ENV: "development",
        STORAGE_PROVIDER: "b2",
        B2_ENDPOINT: "https://s3.us-west-004.backblazeb2.com",
        B2_REGION: "us-west-004",
        B2_BUCKET: "bucket",
        B2_KEY_ID: "key",
        B2_APPLICATION_KEY: "secret",
      }),
    ).toMatchObject({ provider: "b2" });
    expect(() =>
      loadStorageConfig({
        ...base,
        NODE_ENV: "production",
        STORAGE_PROVIDER: "filesystem",
      }),
    ).toThrow("Production storage provider must be b2");
  });
});
