export interface Series {
  id: string;
  title: string;
  slug: string;
  description: string | null;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
}

export interface SeriesInput {
  title: string;
  slug: string;
  description?: string | null;
}
