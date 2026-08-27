export interface PublicImage {
  id: string;
  filename: string;
  extension: string;
  contentType: string;
  sizeBytes: number;
  sortOrder: number;
  url: string;
}

export interface PublicChapter {
  id: string;
  seriesId: string;
  chapterNumber: number;
  title: string | null;
  images: PublicImage[];
}
