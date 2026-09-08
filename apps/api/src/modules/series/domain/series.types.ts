export type SeriesPrincipalUploader = {
  id: string;
  email: string;
};

export type SeriesUploaderCandidate = SeriesPrincipalUploader;

export type SeriesRecord = {
  id: string;
  title: string;
  slug: string;
  description: string | null;
  coverUrl: string | null;
  discordChannelId: string | null;
  discordChannelNameSnapshot: string | null;
  principalUploader: SeriesPrincipalUploader | null;
  createdBy: string;
  createdAt: Date;
  updatedAt: Date;
};

export type ChapterCoreRecord = {
  id: string;
  seriesId: string;
  chapterNumber: number;
  publicKey: string;
  title: string | null;
  status:
    | "draft"
    | "uploading"
    | "uploaded"
    | "processing"
    | "ready"
    | "failed"
    | "deleting";
  createdBy: string;
  createdAt: Date;
  updatedAt: Date;
};
