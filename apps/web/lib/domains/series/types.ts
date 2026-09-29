export interface Series {
  id: string;
  title: string;
  slug: string;
  description: string | null;
  coverUrl: string | null;
  discordChannelId: string | null;
  discordChannelNameSnapshot: string | null;
  responsibleUser: SeriesResponsibleUser | null;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
}

/** Collection-only projection returned by GET /series. */
export interface SeriesListProjection extends Series {
  chapterCount: number;
  imageCount: number;
}

export interface SeriesResponsibleUser {
  id: string;
  email: string;
  role: "admin" | "gestor" | "uploader";
  discordUsername?: string | null;
}

export type SeriesResponsibleCandidate = SeriesResponsibleUser;

export interface SeriesInput {
  title: string;
  description?: string | null;
  coverUrl?: string | null;
  grantId?: string;
  discordChannelId?: string;
}

export interface SelectableDiscordSeriesChannel {
  id: string;
  name: string;
}

export interface SeriesCapabilitiesProjection {
  capabilities: readonly string[];
}
