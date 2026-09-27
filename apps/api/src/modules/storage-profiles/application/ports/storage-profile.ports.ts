import type { StorageProfile } from "../../domain/storage-profile.js";

export interface SecretCipherPort {
  encrypt(plaintext: string): string;
  decrypt(ciphertext: string): string;
}

export interface StorageProfileRepository {
  list(): Promise<StorageProfile[]>;
  findById(id: string): Promise<StorageProfile | null>;
  createDraft(input: {
    name: string;
    publicHostnameLabel: string;
    publicHostname: string;
    b2Endpoint: string | null;
    b2Region: string | null;
    b2Bucket: string | null;
    b2KeyId: string | null;
    encryptedApplicationKey: string | null;
    actorId: string;
    requestId?: string;
  }): Promise<StorageProfile>;
  updateDraft(input: {
    id: string;
    name?: string;
    publicHostnameLabel?: string;
    publicHostname?: string;
    b2Endpoint?: string | null;
    b2Region?: string | null;
    b2Bucket?: string | null;
    b2KeyId?: string | null;
    encryptedApplicationKey?: string;
    actorId: string;
    requestId?: string;
  }): Promise<StorageProfile | null>;
}
