import type {
  PublishedChapterRecord,
  PublishedImageRecord,
} from "../../domain/publication.types.js";

export interface PublishedChapterRepositoryPort {
  findChapterById(chapterId: string): Promise<PublishedChapterRecord | null>;
  listImagesByChapterId(
    chapterId: string,
  ): Promise<readonly PublishedImageRecord[]>;
}
