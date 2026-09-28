import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import { B2Storage, B2UploadTransfer } from "./adapters.js";
import type { StoragePort, UploadTransferPort } from "./port.js";

export const LEGACY_STORAGE_PROFILE_ID = "00000000-0000-4000-8000-000000000001";

export type StorageRuntimeProfile = {
  id: string;
  provider: "b2";
  source: "env" | "managed";
  status: "draft" | "ready" | "active" | "retired";
  credentialVersion: number;
  b2Endpoint: string | null;
  b2Region: string | null;
  b2Bucket: string | null;
  b2KeyId: string | null;
  encryptedApplicationKey: string | null;
};

export interface StorageExecutionResolver {
  storageFor(profileId: string): Promise<StoragePort>;
  uploadTransferFor(profileId: string): Promise<UploadTransferPort>;
}

export interface ActiveStorageProfilePort {
  getActiveStorageProfileId(): Promise<string>;
}

export interface SecretCipherPort {
  encrypt(plaintext: string): string;
  decrypt(ciphertext: string): string;
}

/** Shared by API credential writes and Worker runtime resolution. */
export class AesGcmSecretCipher implements SecretCipherPort {
  private readonly key: Buffer;

  constructor(base64Key: string) {
    const key = Buffer.from(base64Key, "base64");
    if (key.length !== 32 || key.toString("base64") !== base64Key)
      throw new Error("storage-profile-cipher-key-invalid");
    this.key = key;
  }

  encrypt(plaintext: string): string {
    const iv = randomBytes(12);
    const cipher = createCipheriv("aes-256-gcm", this.key, iv);
    const encrypted = Buffer.concat([
      cipher.update(plaintext, "utf8"),
      cipher.final(),
    ]);
    return [
      "v1",
      iv.toString("base64"),
      cipher.getAuthTag().toString("base64"),
      encrypted.toString("base64"),
    ].join(":");
  }

  decrypt(value: string): string {
    const [version, iv, tag, ciphertext, extra] = value.split(":");
    if (version !== "v1" || !iv || !tag || !ciphertext || extra)
      throw new Error("storage-profile-runtime-secret-invalid");
    const decipher = createDecipheriv(
      "aes-256-gcm",
      this.key,
      Buffer.from(iv, "base64"),
    );
    decipher.setAuthTag(Buffer.from(tag, "base64"));
    try {
      return Buffer.concat([
        decipher.update(Buffer.from(ciphertext, "base64")),
        decipher.final(),
      ]).toString("utf8");
    } catch {
      throw new Error("storage-profile-runtime-secret-invalid");
    }
  }
}

export class StorageClientRegistry implements StorageExecutionResolver {
  private readonly clients = new Map<
    string,
    { storage: StoragePort; transfer: UploadTransferPort | null }
  >();

  constructor(
    private readonly loadProfile: (
      profileId: string,
    ) => Promise<StorageRuntimeProfile | null>,
    private readonly legacy: {
      storage: StoragePort;
      transfer: UploadTransferPort | null;
    },
    private readonly masterKey: string | undefined,
  ) {}

  async storageFor(profileId: string): Promise<StoragePort> {
    return (await this.resolve(profileId)).storage;
  }

  async uploadTransferFor(profileId: string): Promise<UploadTransferPort> {
    const transfer = (await this.resolve(profileId)).transfer;
    if (!transfer) throw new Error("storage-profile-transfer-unavailable");
    return transfer;
  }

  private async resolve(profileId: string) {
    const profile = await this.loadProfile(profileId);
    if (!profile) throw new Error("storage-profile-not-found");
    if (profile.id !== profileId)
      throw new Error("storage-profile-runtime-config-invalid");
    if (profile.provider !== "b2" || profile.status === "draft")
      throw new Error("storage-profile-runtime-config-invalid");
    const cacheKey = [profile.id, profile.credentialVersion].join(":");
    const cached = this.clients.get(cacheKey);
    if (cached) return cached;
    if (profile.source === "env") {
      if (
        profile.id !== LEGACY_STORAGE_PROFILE_ID ||
        profile.credentialVersion !== 0 ||
        profile.encryptedApplicationKey !== null
      )
        throw new Error("storage-profile-runtime-config-invalid");
      this.clients.set(cacheKey, this.legacy);
      return this.legacy;
    }
    if (
      !profile.b2Endpoint ||
      !profile.b2Region ||
      !profile.b2Bucket ||
      !profile.b2KeyId ||
      !profile.encryptedApplicationKey
    )
      throw new Error("storage-profile-runtime-config-invalid");
    if (!this.masterKey) throw new Error("storage-profile-cipher-unavailable");
    const secret = new AesGcmSecretCipher(this.masterKey).decrypt(
      profile.encryptedApplicationKey,
    );
    const b2 = {
      B2_ENDPOINT: profile.b2Endpoint,
      B2_REGION: profile.b2Region,
      B2_BUCKET: profile.b2Bucket,
      B2_KEY_ID: profile.b2KeyId,
      B2_APPLICATION_KEY: secret,
    };
    const client = {
      storage: new B2Storage(b2),
      transfer: new B2UploadTransfer(b2),
    };
    this.clients.set(cacheKey, client);
    return client;
  }
}
