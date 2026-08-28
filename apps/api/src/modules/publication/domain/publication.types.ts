export type PublishedChapterRecord = {
  id: string;
  seriesId: string;
  seriesPublicSlug: string;
  chapterNumber: number;
  chapterPublicKey: string;
  title: string | null;
  status:
    | "draft"
    | "uploading"
    | "uploaded"
    | "processing"
    | "ready"
    | "failed"
    | "deleting";
};

export type PublishedImageRecord = {
  id: string;
  chapterId: string;
  filename: string;
  storageKey: string;
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
