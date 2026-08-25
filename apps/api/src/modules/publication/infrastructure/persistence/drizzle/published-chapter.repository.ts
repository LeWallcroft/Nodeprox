import type { ChapterCoreRepositoryPort } from "../../../../series/application/ports/series.ports.js";
import type { ImageRepositoryPort } from "../../../../images/application/ports.js";
import type { PublishedChapterRepositoryPort } from "../../../application/ports/published-chapter.repository.js";

export class DrizzlePublishedChapterRepository
  implements PublishedChapterRepositoryPort
{
  constructor(
    private readonly chapters: ChapterCoreRepositoryPort,
    private readonly images: ImageRepositoryPort,
  ) {}

  findChapterById(chapterId: string) {
    return this.chapters.findById(chapterId);
  }

  async listImagesByChapterId(chapterId: string) {
    const images = await this.images.listByChapterId(chapterId);
    return images.map(
      ({
        id,
        chapterId: imageChapterId,
        filename,
        extension,
        contentType,
        sizeBytes,
        sortOrder,
      }) => ({
        id,
        chapterId: imageChapterId,
        filename,
        extension,
        contentType,
        sizeBytes,
        sortOrder,
      }),
    );
  }
}
