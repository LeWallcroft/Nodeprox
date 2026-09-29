import { describe, expect, it } from "vitest";
import {
  projectStorageCapabilities,
  storageProfileErrorMessage,
} from "./presentation";
import type { StorageProfileDetail } from "./types";

const profile: StorageProfileDetail = {
  id: "profile-1",
  provider: "b2",
  source: "managed",
  status: "draft",
  name: "Borrador",
  publicHostnameLabel: "manga",
  publicHostname: "manga.nodeprox.org",
  publicUrlPreview: "https://manga.nodeprox.org",
  credentialConfigured: false,
  credentialVersion: 0,
  cloudflareProvisioningStatus: "pending",
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
  b2Endpoint: null,
  b2Region: null,
  b2Bucket: null,
  b2KeyId: null,
};

describe("storage profile presentation", () => {
  it("projects draft capabilities without creating authorization", () => {
    const result = projectStorageCapabilities(profile, undefined);
    expect(result.allowed).toContain("Guardar o rotar credenciales");
    expect(result.denied).toContain("Migrar media histórica");
  });

  it("maps provider codes to human copy and keeps unknown codes generic", () => {
    expect(storageProfileErrorMessage("B2_BUCKET_NOT_PUBLIC")).toContain(
      "bucket debe ser público",
    );
    expect(
      storageProfileErrorMessage("UNRECOGNIZED_PROVIDER_ERROR"),
    ).not.toContain("UNRECOGNIZED_PROVIDER_ERROR");
  });
});
