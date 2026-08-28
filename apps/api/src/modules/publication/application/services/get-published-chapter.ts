import { PublicMediaUrl } from "../../../images/domain/public-media-url.js";
import type { PublishedChapterRepositoryPort } from "../ports/published-chapter.repository.js";
import type { PublicChapterDto } from "../../domain/publication.types.js";

export class PublishedChapterNotFoundError extends Error {
  constructor() {
    super("published-chapter-not-found");
    this.name = "PublishedChapterNotFoundError";
  }
}

export class PublishedChapterIntegrityError extends Error {
  constructor() {
    super("published-chapter-integrity-error");
    this.name = "PublishedChapterIntegrityError";
  }
}

export class GetPublishedChapter {
  constructor(
    private readonly repository: PublishedChapterRepositoryPort,
    private readonly publicMediaOrigin: string,
  ) {}

  async execute(chapterId: string): Promise<PublicChapterDto> {
    const chapter = await this.repository.findChapterById(chapterId);
    if (chapter?.status !== "ready") throw new PublishedChapterNotFoundError();

    const images = await this.repository.listImagesByChapterId(chapter.id);
    if (images.length === 0) throw new PublishedChapterIntegrityError();

    const sortOrders = new Set<number>();
    const publicImages = images.map((image) => {
      if (
        image.chapterId !== chapter.id ||
        image.filename.trim().length === 0 ||
        image.sizeBytes <= 0 ||
        !Number.isInteger(image.sizeBytes) ||
        !Number.isInteger(image.sortOrder) ||
        image.sortOrder < 0 ||
        sortOrders.has(image.sortOrder)
      )
        throw new PublishedChapterIntegrityError();
      sortOrders.add(image.sortOrder);

      let url: string;
      try {
        url = PublicMediaUrl.fromImage(this.publicMediaOrigin, {
          seriesPublicSlug: chapter.seriesPublicSlug,
          chapterPublicKey: chapter.chapterPublicKey,
          filename: image.filename,
          contentType: image.contentType,
        }).toString();
      } catch {
        throw new PublishedChapterIntegrityError();
      }

      return {
        id: image.id,
        filename: image.filename,
        extension: image.extension,
        contentType: image.contentType,
        sizeBytes: image.sizeBytes,
        sortOrder: image.sortOrder,
        url,
      };
    });

    publicImages.sort((left, right) => left.sortOrder - right.sortOrder);
    return {
      id: chapter.id,
      seriesId: chapter.seriesId,
      chapterNumber: chapter.chapterNumber,
      title: chapter.title,
      images: publicImages,
    };
  }
}
