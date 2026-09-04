import type { ChapterReplacementStatus } from "./chapter-replacement-status.js";

export type ChapterReplacementOperation = {
  id: string;
  chapterId: string;
  requestedByUserId: string;
  candidateZipStorageKey: string;
  originalFilename: string;
  contentType: string;
  sizeBytes: number;
  etag: string | null;
  status: ChapterReplacementStatus;
  lastErrorCode: string | null;
  previousImageCount: number | null;
  resultImageCount: number | null;
  retainedImageCount: number | null;
  createdImageCount: number | null;
  retiredImageCount: number | null;
  createdAt: Date;
  updatedAt: Date;
  completedAt: Date | null;
};
