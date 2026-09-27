import type { ChapterReplacementOperation } from "../../domain/chapter-replacement-operation.js";
import type { ChapterReplacementResult } from "../../domain/chapter-replacement-result.js";

export interface ChapterReplacementOperationRepository {
  create(input: {
    id: string;
    chapterId: string;
    requestedByUserId: string;
    candidateZipStorageKey: string;
    storageProfileId: string;
    originalFilename: string;
    contentType: string;
    sizeBytes: number;
    etag?: string;
  }): Promise<ChapterReplacementOperation>;
  findById(id: string): Promise<ChapterReplacementOperation | null>;
  findByIdForChapter(
    replacementId: string,
    chapterId: string,
  ): Promise<ChapterReplacementOperation | null>;
  getCompletedResult(
    replacementId: string,
  ): Promise<ChapterReplacementResult | null>;
}
