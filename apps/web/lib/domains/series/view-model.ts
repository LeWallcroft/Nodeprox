import type { SeriesListProjection, SeriesResponsibleUser } from "./types";

export interface SeriesListItem {
  id: string;
  title: string;
  slug: string;
  description: string | null;
  coverUrl: string | null;
  chapterCount: number;
  imageCount: number;
  responsibleUser: SeriesResponsibleUser | null;
  updatedAt: string;
}

export function toSeriesListItem(series: SeriesListProjection): SeriesListItem {
  return {
    id: series.id,
    title: series.title,
    slug: series.slug,
    description: series.description,
    coverUrl: series.coverUrl,
    chapterCount: series.chapterCount,
    imageCount: series.imageCount,
    responsibleUser: series.responsibleUser,
    updatedAt: series.updatedAt,
  };
}

export function filterSeries(
  items: readonly SeriesListProjection[],
  query: string,
) {
  const value = query.trim().toLocaleLowerCase();
  if (!value) return items;
  return items.filter((series) =>
    `${series.title} ${series.slug}`.toLocaleLowerCase().includes(value),
  );
}

export function filterSeriesByResponsible(
  items: readonly SeriesListProjection[],
  responsibleUserId: string | null | undefined,
) {
  if (!responsibleUserId) return [];
  return items.filter(
    (series) => series.responsibleUser?.id === responsibleUserId,
  );
}
