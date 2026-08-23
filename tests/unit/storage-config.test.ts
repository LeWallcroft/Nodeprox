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
});
