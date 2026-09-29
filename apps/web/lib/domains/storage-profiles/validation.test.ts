import { describe, expect, it } from "vitest";
import type { StorageProfileDraftInput } from "./types";
import {
  validateStorageProfileDraft,
  validateStorageProfileField,
} from "./validation";

const validDraft: StorageProfileDraftInput = {
  name: "  Perfil B  ",
  publicHostnameLabel: "profile-b",
  b2Endpoint: "https://s3.us-west-004.backblazeb2.com",
  b2Region: "us-west-004",
  b2Bucket: "manga-bucket",
  b2KeyId: "key-id",
};

describe("StorageProfile client validation", () => {
  it("accepts a complete profile and rejects invalid/reserved host labels", () => {
    expect(validateStorageProfileDraft(validDraft)).toEqual({});
    expect(
      validateStorageProfileField("publicHostnameLabel", "Media"),
    ).not.toBeNull();
    expect(
      validateStorageProfileField("publicHostnameLabel", "-bad"),
    ).not.toBeNull();
    expect(
      validateStorageProfileField("publicHostnameLabel", "a".repeat(64)),
    ).not.toBeNull();
    expect(
      validateStorageProfileField("publicHostnameLabel", "manga-2"),
    ).toBeNull();
  });

  it("requires an absolute HTTP(S) endpoint and bounds B2 values", () => {
    expect(
      validateStorageProfileField("b2Endpoint", "/relative"),
    ).not.toBeNull();
    expect(
      validateStorageProfileField("b2Endpoint", "ftp://bucket.test"),
    ).not.toBeNull();
    expect(
      validateStorageProfileField("b2Endpoint", "http://s3.example.test"),
    ).toBeNull();
    expect(
      validateStorageProfileField("b2Region", "r".repeat(121)),
    ).not.toBeNull();
    expect(
      validateStorageProfileField("b2Bucket", "b".repeat(256)),
    ).not.toBeNull();
    expect(
      validateStorageProfileField("b2KeyId", "k".repeat(256)),
    ).not.toBeNull();
    expect(
      validateStorageProfileField("b2ApplicationKey", "s".repeat(2049)),
    ).not.toBeNull();
  });
});
