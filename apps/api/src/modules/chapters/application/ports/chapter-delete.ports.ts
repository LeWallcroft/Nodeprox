import type { ChapterRecord } from "../../domain/chapter.types.js";

export interface ChapterDeleteRepositoryPort {
  findById(id: string): Promise<ChapterRecord | null>;
  delete(id: string): Promise<void>;
  isAssigned?(seriesId: string, userId: string): Promise<boolean>;
  isSeriesOwner?(seriesId: string, userId: string): Promise<boolean>;
}
