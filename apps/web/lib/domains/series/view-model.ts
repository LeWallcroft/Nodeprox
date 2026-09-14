import type { Series, SeriesResponsibleUser } from "./types";

export interface SeriesListItem {
  id: string;
  title: string;
  slug: string;
  description: string | null;
  coverUrl: string | null;
  responsibleUser: SeriesResponsibleUser | null;
  updatedAt: string;
}

export function toSeriesListItem(series: Series): SeriesListItem {
  return {
    id: series.id,
    title: series.title,
    slug: series.slug,
    description: series.description,
    coverUrl: series.coverUrl,
    responsibleUser: series.responsibleUser,
    updatedAt: series.updatedAt,
  };
}

export function filterSeries(items: readonly Series[], query: string) {
  const value = query.trim().toLocaleLowerCase();
  if (!value) return items;
  return items.filter((series) =>
    `${series.title} ${series.slug}`.toLocaleLowerCase().includes(value),
  );
}
