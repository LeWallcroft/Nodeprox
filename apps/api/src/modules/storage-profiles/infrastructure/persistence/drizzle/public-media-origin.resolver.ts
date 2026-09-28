import { eq } from "drizzle-orm";
import type { NodeProxDatabase } from "../../../../../../../../database/client.js";
import { storageProfiles } from "../../../../../../../../database/schema/index.js";
import { LEGACY_STORAGE_PROFILE_ID } from "../../../domain/storage-profile.js";
import type { PublicMediaOriginResolver } from "../../../application/ports/public-media-origin.port.js";

export class DrizzlePublicMediaOriginResolver
  implements PublicMediaOriginResolver
{
  constructor(
    private readonly db: NodeProxDatabase,
    private readonly legacyDevelopmentOrigin: string,
    private readonly production: boolean,
  ) {}
  async originFor(storageProfileId: string): Promise<string> {
    const [profile] = await this.db
      .select({
        id: storageProfiles.id,
        source: storageProfiles.source,
        hostname: storageProfiles.publicHostname,
      })
      .from(storageProfiles)
      .where(eq(storageProfiles.id, storageProfileId))
      .limit(1);
    if (!profile) throw new Error("storage-profile-public-origin-unavailable");
    if (profile.id === LEGACY_STORAGE_PROFILE_ID) {
      if (profile.source !== "env" || profile.hostname !== "media.nodeprox.org")
        throw new Error("storage-profile-public-origin-invalid");
      if (!this.production) return this.legacyDevelopmentOrigin;
    } else if (
      profile.source !== "managed" ||
      !/^[a-z0-9-]+\.nodeprox\.org$/.test(profile.hostname) ||
      profile.hostname === "media.nodeprox.org"
    ) {
      throw new Error("storage-profile-public-origin-invalid");
    }
    return `https://${profile.hostname}`;
  }
}
