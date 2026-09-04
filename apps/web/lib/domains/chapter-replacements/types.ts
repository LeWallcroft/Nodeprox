import type { InitiatedUpload } from "../uploads/types";

export type ChapterReplacementStatus =
  | "pending_upload"
  | "uploaded"
  | "processing"
  | "ready"
  | "completing"
  | "completed"
  | "failed";

export type ChapterReplacementResult = {
  replacementId: string;
  chapterId: string;
  previousImageCount: number;
  imageCount: number;
  retainedImageCount: number;
  createdImageCount: number;
  retiredImageCount: number;
  completedAt: string;
};

export type ChapterReplacementProjection = {
  replacementId: string;
  chapterId: string;
  status: ChapterReplacementStatus;
  errorCode?: string;
  result?: ChapterReplacementResult;
};

export type PreparedChapterReplacement = {
  replacementId: string;
  chapterId: string;
  upload: InitiatedUpload["transfer"];
};

export type WholeChapterReplacementPhase =
  | "idle"
  | "selected"
  | "uploading"
  | "processing"
  | "applying"
  | "completed"
  | "failed";
