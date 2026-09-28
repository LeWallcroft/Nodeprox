import { randomBytes } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import {
  AesGcmSecretCipher,
  LEGACY_STORAGE_PROFILE_ID,
  StorageClientRegistry,
  type StorageRuntimeProfile,
} from "@nodeprox/storage/profile-execution";
import type { StoragePort, UploadTransferPort } from "@nodeprox/storage/port";

const legacyStorage = {
  put: vi.fn(),
  get: vi.fn(),
  exists: vi.fn(),
  delete: vi.fn(),
} as StoragePort;
const legacyTransfer = {
  initiate: vi.fn(),
  verify: vi.fn(),
  abort: vi.fn(),
} as UploadTransferPort;

const legacy: StorageRuntimeProfile = {
  id: LEGACY_STORAGE_PROFILE_ID,
  provider: "b2",
  source: "env",
  status: "active",
  credentialVersion: 0,
  b2Endpoint: null,
  b2Region: null,
  b2Bucket: null,
  b2KeyId: null,
  encryptedApplicationKey: null,
};

describe("profile-aware storage execution", () => {
  it("routes the deterministic legacy profile to injected environment adapters", async () => {
    const registry = new StorageClientRegistry(
      async () => legacy,
      {
        storage: legacyStorage,
        transfer: legacyTransfer,
      },
      undefined,
    );
    expect(await registry.storageFor(LEGACY_STORAGE_PROFILE_ID)).toBe(
      legacyStorage,
    );
    expect(await registry.uploadTransferFor(LEGACY_STORAGE_PROFILE_ID)).toBe(
      legacyTransfer,
    );
    await expect(registry.storageFor("other")).rejects.toThrow(
      "storage-profile-runtime-config-invalid",
    );
  });

  it("uses profile ID plus credential version as the managed client cache identity", async () => {
    const masterKey = randomBytes(32).toString("base64");
    const cipher = new AesGcmSecretCipher(masterKey);
    let version = 1;
    const load = vi.fn(
      async (): Promise<StorageRuntimeProfile> => ({
        ...legacy,
        id: "11111111-1111-4111-8111-111111111111",
        source: "managed",
        status: "retired",
        credentialVersion: version,
        b2Endpoint: "https://s3.example.invalid",
        b2Region: "us-west-001",
        b2Bucket: "example",
        b2KeyId: "key-id",
        encryptedApplicationKey: cipher.encrypt("test-only-secret"),
      }),
    );
    const registry = new StorageClientRegistry(
      load,
      { storage: legacyStorage, transfer: legacyTransfer },
      masterKey,
    );
    const first = await registry.storageFor(
      "11111111-1111-4111-8111-111111111111",
    );
    expect(
      await registry.storageFor("11111111-1111-4111-8111-111111111111"),
    ).toBe(first);
    version = 2;
    expect(
      await registry.storageFor("11111111-1111-4111-8111-111111111111"),
    ).not.toBe(first);
    expect(load).toHaveBeenCalledTimes(3);
  });

  it("fails closed for draft or unknown profiles", async () => {
    const draft = new StorageClientRegistry(
      async () => ({ ...legacy, status: "draft" }),
      { storage: legacyStorage, transfer: legacyTransfer },
      undefined,
    );
    await expect(draft.storageFor(LEGACY_STORAGE_PROFILE_ID)).rejects.toThrow(
      "storage-profile-runtime-config-invalid",
    );
    const unknown = new StorageClientRegistry(
      async () => null,
      { storage: legacyStorage, transfer: legacyTransfer },
      undefined,
    );
    await expect(unknown.storageFor(LEGACY_STORAGE_PROFILE_ID)).rejects.toThrow(
      "storage-profile-not-found",
    );
  });
});
