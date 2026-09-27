import type {
  ActiveStorageProfilePort,
  StorageRuntimeProfile,
} from "@nodeprox/storage/profile-execution";
import { eq } from "drizzle-orm";
import type { NodeProxDatabase } from "./client.js";
import { storageProfiles } from "./schema/index.js";

export class DrizzleStorageProfileRuntimeRepository
  implements ActiveStorageProfilePort
{
  constructor(private readonly db: NodeProxDatabase) {}

  async getActiveStorageProfileId(): Promise<string> {
    const active = await this.db
      .select({ id: storageProfiles.id })
      .from(storageProfiles)
      .where(eq(storageProfiles.status, "active"))
      .limit(2);
    const selected = active[0];
    if (active.length !== 1 || !selected)
      throw new Error("storage-profile-active-invariant");
    return selected.id;
  }

  async loadRuntimeProfile(id: string): Promise<StorageRuntimeProfile | null> {
    const [profile] = await this.db
      .select({
        id: storageProfiles.id,
        provider: storageProfiles.provider,
        source: storageProfiles.source,
        status: storageProfiles.status,
        credentialVersion: storageProfiles.credentialVersion,
        b2Endpoint: storageProfiles.b2Endpoint,
        b2Region: storageProfiles.b2Region,
        b2Bucket: storageProfiles.b2Bucket,
        b2KeyId: storageProfiles.b2KeyId,
        encryptedApplicationKey: storageProfiles.encryptedApplicationKey,
      })
      .from(storageProfiles)
      .where(eq(storageProfiles.id, id))
      .limit(1);
    return profile ?? null;
  }
}
