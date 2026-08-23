export const chapterStatuses = [
  "draft",
  "uploading",
  "uploaded",
  "processing",
  "ready",
  "failed",
] as const;

export type ChapterStatus = (typeof chapterStatuses)[number];

export interface Chapter {
  id: string;
  seriesId: string;
  chapterNumber: number;
  title: string | null;
  status: ChapterStatus;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
}

export interface ChapterInput {
  chapterNumber: number;
  title?: string | null;
}
