export const chapterReplacementStatuses = [
  "pending_upload",
  "uploaded",
  "validating",
  "retry_exhausted",
  "processing",
  "ready",
  "completing",
  "completed",
  "failed",
  "rejected",
  "terminal_failed",
] as const;

export type ChapterReplacementStatus =
  (typeof chapterReplacementStatuses)[number];
