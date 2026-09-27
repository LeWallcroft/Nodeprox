import { randomBytes } from "node:crypto";
import { describe, expect, it } from "vitest";
import { loadStorageProfileConfig } from "../../packages/config/src/index.js";

describe("storage profile secret configuration", () => {
  it("permits read-only profile management when the master key is absent", () => {
    expect(loadStorageProfileConfig({})).toEqual({
      STORAGE_PROFILE_MASTER_KEY: undefined,
      STORAGE_RESERVED_HOSTNAME_LABELS: "",
    });
  });

  it("accepts a 32-byte base64 master key and rejects malformed keys", () => {
    const key = randomBytes(32).toString("base64");
    expect(
      loadStorageProfileConfig({ STORAGE_PROFILE_MASTER_KEY: key })
        .STORAGE_PROFILE_MASTER_KEY,
    ).toBe(key);
    expect(() =>
      loadStorageProfileConfig({ STORAGE_PROFILE_MASTER_KEY: "bad-key" }),
    ).toThrow();
  });
});
