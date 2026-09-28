import type { SecretCipherPort } from "@nodeprox/storage/profile-execution";
import type { B2BucketAdministrationPort } from "./ports/b2-administration.ports.js";
import type { StorageProfileReadinessRepository } from "./ports/storage-profile-readiness.ports.js";
import { storageProfileDetailView } from "../domain/storage-profile.js";

export class StorageProfileCredentialRotationService {
  constructor(
    private readonly repository: StorageProfileReadinessRepository,
    private readonly administration: B2BucketAdministrationPort,
    private readonly cipher: SecretCipherPort | null,
  ) {}

  async rotate(input: {
    profileId: string;
    actorId: string;
    requestId?: string;
    b2KeyId: string;
    b2ApplicationKey: string;
  }) {
    const profile = await this.repository.findById(input.profileId);
    if (
      profile?.source !== "managed" ||
      !profile.b2Endpoint ||
      !profile.b2Region ||
      !profile.b2Bucket
    )
      throw new Error("storage-profile-conflict");
    if (!this.cipher) throw new Error("storage-profile-cipher-unavailable");
    await this.administration.validateCredentials({
      endpoint: profile.b2Endpoint,
      region: profile.b2Region,
      bucket: profile.b2Bucket,
      keyId: input.b2KeyId,
      applicationKey: input.b2ApplicationKey,
    });
    const ciphertext = this.cipher.encrypt(input.b2ApplicationKey);
    const updated = await this.repository.rotateCredentials({
      profileId: profile.id,
      b2KeyId: input.b2KeyId,
      encryptedApplicationKey: ciphertext,
      actorId: input.actorId,
      ...(input.requestId ? { requestId: input.requestId } : {}),
    });
    return storageProfileDetailView(updated);
  }
}
