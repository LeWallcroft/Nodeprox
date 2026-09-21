export const chapterStatuses = [
  "draft",
  "uploading",
  "uploaded",
  "processing",
  "ready",
  "failed",
  "deleting",
] as const;

export type ChapterStatus = (typeof chapterStatuses)[number];

export interface Chapter {
  id: string;
  seriesId: string;
  chapterNumber: number;
  publicKey: string;
  title: string | null;
  status: ChapterStatus;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
}

/** Read projection for the scoped Series chapters collection. */
export interface SeriesChapterListItem extends Chapter {
  imageCount: number;
}

export interface ChapterInput {
  chapterNumber: number;
  title?: string | null;
}

export interface ChapterCapabilitiesProjection {
  capabilities: readonly string[];
}

export interface GlobalChapter extends Chapter {
  series: { id: string; title: string; slug: string; coverUrl: string | null };
  imageCount: number;
  responsibleUser: {
    id: string;
    email: string;
    role: "admin" | "gestor" | "uploader";
  } | null;
}

export interface ChapterHelper {
  userId: string;
  email: string;
  discordUsername?: string | null;
  permissions: readonly string[];
  grantedAt: string;
}

export interface HelperCandidate {
  id: string;
  email: string;
  discordUsername?: string | null;
}
