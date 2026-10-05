import type { ChapterReplacementOperation } from "../../domain/chapter-replacement-operation.js";
import type { ChapterReplacementResult } from "../../domain/chapter-replacement-result.js";

export type ChapterReplacementProcessingIntent = {
  id: string;
  replacementId: string;
  chapterId: string;
  originRequestId?: string;
};

export interface ChapterReplacementUploadRepository {
  createPending(input: {
    id: string;
    chapterId: string;
    requestedByUserId: string;
    candidateZipStorageKey: string;
    storageProfileId: string;
    originalFilename: string;
    contentType: string;
    sizeBytes: number;
  }): Promise<ChapterReplacementOperation | null>;
  markPreparationFailed(replacementId: string, code: string): Promise<void>;
  findByIdForChapter(
    replacementId: string,
    chapterId: string,
  ): Promise<ChapterReplacementOperation | null>;
  getCompletedResult(
    replacementId: string,
  ): Promise<ChapterReplacementResult | null>;
  markValidatingAndEnqueue(input: {
    replacementId: string;
    chapterId: string;
    etag?: string;
    originRequestId?: string;
  }): Promise<ChapterReplacementOperation | null>;
}

export interface ChapterReplacementProcessingOutboxPort {
  findPending(limit: number): Promise<ChapterReplacementProcessingIntent[]>;
  markEnqueued(id: string): Promise<void>;
}
