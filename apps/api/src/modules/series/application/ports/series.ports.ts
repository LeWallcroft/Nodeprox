import type {
  ChapterCoreRecord,
  SeriesRecord,
} from "../../domain/series.types.js";

export interface SeriesRepositoryPort {
  create(input: {
    title: string;
    slug: string;
    description?: string | null | undefined;
    createdBy: string;
  }): Promise<SeriesRecord>;
  listByOwner(ownerId: string): Promise<SeriesRecord[]>;
  findById(id: string): Promise<SeriesRecord | null>;
  update(
    id: string,
    input: {
      title?: string | undefined;
      slug?: string | undefined;
      description?: string | null | undefined;
    },
  ): Promise<SeriesRecord | null>;
  delete(id: string): Promise<void>;
  countChapters(id: string): Promise<number>;
}

export interface ChapterCoreRepositoryPort {
  create(input: {
    seriesId: string;
    chapterNumber: number;
    title?: string | null | undefined;
    createdBy: string;
  }): Promise<ChapterCoreRecord>;
  listBySeries(seriesId: string): Promise<ChapterCoreRecord[]>;
  findById(id: string): Promise<ChapterCoreRecord | null>;
  update(
    id: string,
    input: {
      chapterNumber?: number | undefined;
      title?: string | null | undefined;
    },
  ): Promise<ChapterCoreRecord | null>;
  delete(id: string): Promise<void>;
}
