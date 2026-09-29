export type SeriesResponsibleUser = {
  id: string;
  email: string;
  role: "admin" | "gestor" | "uploader";
  discordUsername?: string | null;
};

export type SeriesResponsibleCandidate = SeriesResponsibleUser;

export type SeriesRecord = {
  id: string;
  title: string;
  slug: string;
  description: string | null;
  coverUrl: string | null;
  discordChannelId: string | null;
  discordChannelNameSnapshot: string | null;
  responsibleUser: SeriesResponsibleUser | null;
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
