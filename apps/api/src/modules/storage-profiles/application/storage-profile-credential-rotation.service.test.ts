import { describe, expect, it, vi } from "vitest";
import { AesGcmSecretCipher } from "@nodeprox/storage/profile-execution";
import type { B2BucketAdministrationPort } from "./ports/b2-administration.ports.js";
import type { StorageProfileReadinessRepository } from "./ports/storage-profile-readiness.ports.js";
import type { StorageProfile } from "../domain/storage-profile.js";
import { StorageProfileCredentialRotationService } from "./storage-profile-credential-rotation.service.js";

function fixture() {
  const profile = {
    id: "profile",
    source: "managed",
    status: "active",
    provider: "b2",
    name: "Managed",
    publicHostname: "manga.nodeprox.org",
    publicHostnameLabel: "manga",
    createdAt: new Date(),
    updatedAt: new Date(),
    cloudflareProvisioningStatus: "verified",
    b2Endpoint: "https://s3.example.test",
    b2Region: "region",
    b2Bucket: "bucket",
    b2KeyId: "old-key",
    encryptedApplicationKey: "old-cipher",
    credentialVersion: 1,
  } as StorageProfile;
  const repo = {
    findById: vi.fn(async () => profile),
    rotateCredentials: vi.fn(
      async (input: { b2KeyId: string; encryptedApplicationKey: string }) => {
        profile.b2KeyId = input.b2KeyId;
        profile.encryptedApplicationKey = input.encryptedApplicationKey;
        profile.credentialVersion++;
        return profile;
      },
    ),
  } as unknown as StorageProfileReadinessRepository;
  const admin = {
    validateCredentials: vi.fn(async () => {}),
  } as unknown as B2BucketAdministrationPort;
  const cipher = new AesGcmSecretCipher(Buffer.alloc(32, 5).toString("base64"));
  return {
    profile,
    repo,
    admin,
    cipher,
    service: new StorageProfileCredentialRotationService(repo, admin, cipher),
  };
}

describe("managed credential rotation", () => {
  it("validates then atomically replaces encrypted credentials and increments version", async () => {
    const f = fixture();
    const result = await f.service.rotate({
      profileId: "profile",
      actorId: "actor",
      b2KeyId: "new-key",
      b2ApplicationKey: "new-secret",
    });
    expect(f.admin.validateCredentials).toHaveBeenCalledWith(
      expect.objectContaining({
        bucket: "bucket",
        keyId: "new-key",
        applicationKey: "new-secret",
      }),
    );
    expect(f.profile.credentialVersion).toBe(2);
    if (!f.profile.encryptedApplicationKey)
      throw new Error("missing-ciphertext");
    expect(f.cipher.decrypt(f.profile.encryptedApplicationKey)).toBe(
      "new-secret",
    );
    expect(JSON.stringify(result)).not.toContain("new-secret");
    expect(JSON.stringify(result)).not.toContain(
      f.profile.encryptedApplicationKey,
    );
  });
  it("leaves prior credentials intact when provider validation fails", async () => {
    const f = fixture();
    vi.mocked(f.admin.validateCredentials).mockRejectedValue(
      new Error("B2_AUTHORIZATION_ERROR"),
    );
    await expect(
      f.service.rotate({
        profileId: "profile",
        actorId: "actor",
        b2KeyId: "bad",
        b2ApplicationKey: "bad-secret",
      }),
    ).rejects.toThrow();
    expect(f.repo.rotateCredentials).not.toHaveBeenCalled();
    expect(f.profile.credentialVersion).toBe(1);
  });
});
