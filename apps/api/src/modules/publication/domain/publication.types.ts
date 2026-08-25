export type PublishedChapterRecord = {
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
};

export type PublishedImageRecord = {
  id: string;
  chapterId: string;
  filename: string;
  extension: string;
  contentType: string;
  sizeBytes: number;
  sortOrder: number;
};

export type PublicChapterDto = {
  id: string;
  seriesId: string;
  chapterNumber: number;
  title: string | null;
  images: Array<{
    id: string;
    filename: string;
    extension: string;
    contentType: string;
    sizeBytes: number;
    sortOrder: number;
    url: string;
  }>;
};
