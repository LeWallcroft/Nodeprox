import { eq } from "drizzle-orm";
import type { NodeProxDatabase } from "../../../../../../../../database/client.js";
import {
  chapters,
  images,
  imageVersions,
  series,
} from "../../../../../../../../database/schema/index.js";
import type { ImageVersionResultRepository } from "../../../application/image-version-result.repository.js";
import { PublicMediaUrl } from "../../../domain/public-media-url.js";
import type { PublicMediaOriginResolver } from "../../../../storage-profiles/application/ports/public-media-origin.port.js";

export class DrizzleImageVersionResultRepository
  implements ImageVersionResultRepository
{
  constructor(
    private readonly db: NodeProxDatabase,
    private readonly publicMediaOrigin: string | PublicMediaOriginResolver,
  ) {}

  async findVersionResultById(imageVersionId: string) {
    const [row] = await this.db
      .select({
        imageId: images.id,
        versionId: imageVersions.id,
        version: imageVersions.version,
        filename: imageVersions.physicalFilename,
        storageKey: imageVersions.storageKey,
        storageProfileId: imageVersions.storageProfileId,
        contentType: imageVersions.contentType,
        seriesSlug: series.slug,
        chapterPublicKey: chapters.publicKey,
      })
      .from(imageVersions)
      .innerJoin(images, eq(images.id, imageVersions.imageId))
      .innerJoin(chapters, eq(chapters.id, images.chapterId))
      .innerJoin(series, eq(series.id, chapters.seriesId))
      .where(eq(imageVersions.id, imageVersionId))
      .limit(1);
    if (!row) return null;
    return {
      imageId: row.imageId,
      versionId: row.versionId,
      version: row.version,
      filename: row.filename,
      storageKey: row.storageKey,
      publicUrl: PublicMediaUrl.fromImage(
        typeof this.publicMediaOrigin === "string"
          ? this.publicMediaOrigin
          : await this.publicMediaOrigin.originFor(row.storageProfileId),
        {
          seriesPublicSlug: row.seriesSlug,
          chapterPublicKey: row.chapterPublicKey,
          filename: row.filename,
          contentType: row.contentType,
        },
      ).toString(),
    };
  }
}
