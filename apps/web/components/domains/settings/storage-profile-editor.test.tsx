import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { StorageProfileDetail } from "../../../lib/domains/storage-profiles/types";
import { StorageProfileEditor } from "./storage-profile-editor";

const legacyProfile: StorageProfileDetail = {
  id: "00000000-0000-4000-8000-000000000001",
  provider: "b2",
  source: "env",
  status: "active",
  name: "Legacy environment",
  publicHostnameLabel: "media",
  publicHostname: "media.nodeprox.org",
  publicUrlPreview: "https://media.nodeprox.org",
  credentialConfigured: true,
  credentialVersion: 0,
  cloudflareProvisioningStatus: "verified",
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
  b2Endpoint: null,
  b2Region: null,
  b2Bucket: null,
  b2KeyId: null,
};

describe("StorageProfile editor presentation", () => {
  it("presents the environment-backed legacy profile as immutable without credential controls", () => {
    const markup = renderToStaticMarkup(
      <StorageProfileEditor
        profile={legacyProfile}
        busy={false}
        onSave={async () => undefined}
      />,
    );

    expect(markup).toContain("Perfil legacy");
    expect(markup).toContain("solo lectura");
    expect(markup).toContain("https://media.nodeprox.org");
    expect(markup).toContain("No se guardan ni se muestran");
    expect(markup).not.toContain("Application Key secreta");
    expect(markup).not.toContain('type="password"');
    expect(markup).not.toContain("Eliminar");
    expect(markup).not.toContain("Nombre del bucket");
  });

  it("does not render a managed profile's configured Application Key", () => {
    const managedProfile: StorageProfileDetail = {
      ...legacyProfile,
      id: "managed-profile",
      source: "managed",
      status: "draft",
      name: "Secondary bucket",
      publicHostnameLabel: "secondary",
      publicHostname: "secondary.nodeprox.org",
      publicUrlPreview: "https://secondary.nodeprox.org",
      credentialConfigured: true,
      credentialVersion: 1,
      b2Endpoint: "https://s3.us-west-004.backblazeb2.com",
      b2Region: "us-west-004",
      b2Bucket: "nodeprox-secondary",
      b2KeyId: "managed-key-id",
    };
    const plaintext = "temporary-test-secret";
    const markup = renderToStaticMarkup(
      <StorageProfileEditor
        profile={managedProfile}
        busy={false}
        onSave={async () => undefined}
      />,
    );

    expect(markup).not.toContain(plaintext);
    expect(markup).not.toContain(`value="${plaintext}"`);
    expect(markup).toContain("Application Key configurada");
  });
});
