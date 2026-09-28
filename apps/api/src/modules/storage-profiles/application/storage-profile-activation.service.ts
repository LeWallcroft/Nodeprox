import type { StorageProfileReadinessRepository } from "./ports/storage-profile-readiness.ports.js";
import { StorageManagedOperationsDisabledError } from "./cloudflare-storage-profile-provisioning.service.js";
import { storageProfileDetailView } from "../domain/storage-profile.js";

export class StorageProfileActivationService {
  constructor(
    private readonly repository: StorageProfileReadinessRepository,
    private readonly enabled: boolean,
  ) {}
  async activate(profileId: string, actorId: string, requestId?: string) {
    if (!this.enabled) throw new StorageManagedOperationsDisabledError();
    const profile = await this.repository.activate(
      profileId,
      actorId,
      requestId,
    );
    return storageProfileDetailView(profile);
  }
}
