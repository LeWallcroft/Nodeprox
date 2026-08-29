export interface Series {
  id: string;
  title: string;
  slug: string;
  description: string | null;
  coverUrl: string | null;
  principalUploader: SeriesPrincipalUploader | null;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
}

export interface SeriesPrincipalUploader {
  id: string;
  email: string;
  discordUsername?: string | null;
}

export type SeriesUploaderCandidate = SeriesPrincipalUploader;

export interface SeriesInput {
  title: string;
  slug: string;
  description?: string | null;
  coverUrl?: string | null;
}

export interface SeriesCapabilitiesProjection {
  capabilities: readonly string[];
}
