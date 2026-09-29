import { describe, expect, it } from "vitest";
import type { StorageProfileDraftInput } from "../../../lib/domains/storage-profiles/types";
import { toStorageProfileCreateInput } from "./storage-profiles-panel";

const draft: StorageProfileDraftInput = {
  name: "Secondary bucket",
  publicHostnameLabel: "secondary",
  b2Endpoint: "https://s3.us-west-004.backblazeb2.com",
  b2Region: "us-west-004",
  b2Bucket: "nodeprox-secondary",
  b2KeyId: "key-id",
};

describe("StorageProfile create input", () => {
  it("forwards a supplied Application Key to the create mutation payload", () => {
    const input = toStorageProfileCreateInput({
      ...draft,
      b2ApplicationKey: "temporary-test-secret",
    });

    expect(input).toEqual({
      ...draft,
      b2ApplicationKey: "temporary-test-secret",
    });
  });

  it("keeps Application Key optional when none was supplied", () => {
    const input = toStorageProfileCreateInput(draft);

    expect(input).toEqual(draft);
    expect(input).not.toHaveProperty("b2ApplicationKey");
  });
});
