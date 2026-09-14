export interface Series {
  id: string;
  title: string;
  slug: string;
  description: string | null;
  coverUrl: string | null;
  responsibleUser: SeriesResponsibleUser | null;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
}

export interface SeriesResponsibleUser {
  id: string;
  email: string;
  role: "admin" | "gestor" | "uploader";
}

export type SeriesResponsibleCandidate = SeriesResponsibleUser;

export interface SeriesInput {
  title: string;
  description?: string | null;
  coverUrl?: string | null;
  grantId?: string;
}

export interface SeriesCapabilitiesProjection {
  capabilities: readonly string[];
}
