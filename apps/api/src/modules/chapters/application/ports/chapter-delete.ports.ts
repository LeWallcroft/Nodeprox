import type { ChapterRecord } from "../../domain/chapter.types.js";

export interface ChapterDeleteRepositoryPort {
  findById(id: string): Promise<ChapterRecord | null>;
  delete(id: string): Promise<void>;
}
