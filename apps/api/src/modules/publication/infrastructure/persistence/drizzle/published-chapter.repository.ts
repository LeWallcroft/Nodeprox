import { and, asc, eq, isNull } from "drizzle-orm";
import type { NodeProxDatabase } from "../../../../../../../../database/client.js";
import {
  chapters,
  images,
  imageVersions,
  series,
} from "../../../../../../../../database/schema/index.js";
import type { PublishedChapterRepositoryPort } from "../../../application/ports/published-chapter.repository.js";

export class DrizzlePublishedChapterRepository
  implements PublishedChapterRepositoryPort
{
  constructor(private readonly db: NodeProxDatabase) {}

  async findChapterById(chapterId: string) {
    const [row] = await this.db
      .select({
        id: chapters.id,
        seriesId: chapters.seriesId,
        seriesPublicSlug: series.slug,
        chapterNumber: chapters.chapterNumber,
        chapterPublicKey: chapters.publicKey,
        title: chapters.title,
        status: chapters.status,
      })
      .from(chapters)
      .innerJoin(series, eq(series.id, chapters.seriesId))
      .where(eq(chapters.id, chapterId))
      .limit(1);
    return row ?? null;
  }

  async listImagesByChapterId(chapterId: string) {
    return this.db
      .select({
        id: images.id,
        chapterId: images.chapterId,
        filename: imageVersions.physicalFilename,
        storageKey: imageVersions.storageKey,
        storageProfileId: imageVersions.storageProfileId,
        extension: imageVersions.extension,
        contentType: imageVersions.contentType,
        sizeBytes: imageVersions.sizeBytes,
        sortOrder: images.sortOrder,
      })
      .from(images)
      .innerJoin(imageVersions, eq(images.currentVersionId, imageVersions.id))
      .where(and(eq(images.chapterId, chapterId), isNull(images.retiredAt)))
      .orderBy(asc(images.sortOrder));
  }
}
