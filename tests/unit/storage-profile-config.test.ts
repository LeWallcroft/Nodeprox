import { randomBytes } from "node:crypto";
import { describe, expect, it } from "vitest";
import { loadStorageProfileConfig } from "@nodeprox/config";

describe("storage profile secret configuration", () => {
  it("permits read-only profile management when the master key is absent", () => {
    expect(loadStorageProfileConfig({})).toEqual({
      STORAGE_RESERVED_HOSTNAME_LABELS: "",
      STORAGE_BROWSER_UPLOAD_ORIGINS: "http://localhost:3000",
      STORAGE_MANAGED_PROFILE_OPERATIONS_ENABLED: false,
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
