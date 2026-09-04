export const chapterReplacementStatuses = [
  "pending_upload",
  "uploaded",
  "processing",
  "ready",
  "completing",
  "completed",
  "failed",
] as const;

export type ChapterReplacementStatus =
  (typeof chapterReplacementStatuses)[number];
