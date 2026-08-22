export type SeriesRecord = {
  id: string;
  title: string;
  slug: string;
  description: string | null;
  createdBy: string;
  createdAt: Date;
  updatedAt: Date;
};

export type ChapterCoreRecord = {
  id: string;
  seriesId: string;
  chapterNumber: number;
  title: string | null;
  status:
    | "draft"
    | "uploading"
    | "uploaded"
    | "processing"
    | "ready"
    | "failed";
  createdBy: string;
  createdAt: Date;
  updatedAt: Date;
};
