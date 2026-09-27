import { describe, expect, it } from "vitest";
import type { StorageProfile } from "./storage-profile.js";
import {
  canonicalPublicHostnameLabel,
  LEGACY_PUBLIC_HOSTNAME,
  managedPublicHostname,
  storageProfileDetailView,
  storageProfileSummaryView,
} from "./storage-profile.js";

describe("storage profile hostname", () => {
  it("canonicalizes an admin selected label without making it the profile identity", () => {
    expect(canonicalPublicHostnameLabel(" Media-2 ")).toBe("media-2");
    expect(managedPublicHostname("media-2")).toBe("media-2.nodeprox.org");
    expect(LEGACY_PUBLIC_HOSTNAME).toBe("media.nodeprox.org");
  });

  it.each(["", "media", "-name", "name-", "bad.name", "a".repeat(64)])(
    "rejects invalid or reserved label %s",
    (label) => {
      expect(() => canonicalPublicHostnameLabel(label)).toThrow();
    },
  );

  it("rejects configured reserved names", () => {
    expect(() => canonicalPublicHostnameLabel("API", ["api"])).toThrow();
    expect(() => canonicalPublicHostnameLabel("www")).toThrow();
  });

  it("never projects encrypted application keys", () => {
    const profile: StorageProfile = {
      id: "profile-id",
      provider: "b2",
      source: "managed",
      status: "draft",
      name: "Draft",
      publicHostnameLabel: "media2",
      publicHostname: "media2.nodeprox.org",
      b2Endpoint: null,
      b2Region: null,
      b2Bucket: null,
      b2KeyId: null,
      encryptedApplicationKey: "secret-ciphertext",
      credentialVersion: 1,
      dnsRecordId: null,
      transformRulesetId: null,
      transformRuleId: null,
      cacheRulesetId: null,
      cloudflareProvisioningVersion: 0,
      cloudflareProvisioningStatus: "pending",
      cloudflareLastErrorCode: null,
      createdAt: new Date("2026-01-01T00:00:00Z"),
      updatedAt: new Date("2026-01-01T00:00:00Z"),
    };
    const view = storageProfileSummaryView(profile);
    const detail = storageProfileDetailView(profile);
    expect(view).not.toHaveProperty("encryptedApplicationKey");
    expect(detail).not.toHaveProperty("encryptedApplicationKey");
    expect(detail).not.toHaveProperty("b2ApplicationKey");
    expect(detail).toMatchObject({
      b2Endpoint: null,
      b2Region: null,
      b2Bucket: null,
      b2KeyId: null,
    });
    expect(JSON.stringify(view)).not.toContain("secret-ciphertext");
    expect(view.credentialConfigured).toBe(true);
  });
});
