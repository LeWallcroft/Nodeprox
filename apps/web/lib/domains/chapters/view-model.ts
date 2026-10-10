import type { Chapter } from "./types";

export interface ChapterListItem {
  id: string;
  chapterNumber: number;
  publicKey: string;
  title: string | null;
  status: Chapter["status"];
  updatedAt: string;
  imageCount: number;
}

export function latestChapterNumber(
  chapters: readonly { chapterNumber: number }[],
): number | null {
  if (chapters.length === 0) return null;
  return chapters.reduce(
    (latest, chapter) => Math.max(latest, chapter.chapterNumber),
    Number.NEGATIVE_INFINITY,
  );
}

export function latestChapterNumbersBySeries(
  chapters: readonly {
    chapterNumber: number;
    seriesId?: string;
    series?: { id: string };
  }[],
): Readonly<Record<string, number>> {
  const latest: Record<string, number> = {};
  for (const chapter of chapters) {
    const seriesId = chapter.seriesId ?? chapter.series?.id;
    if (!seriesId) continue;
    latest[seriesId] = Math.max(
      latest[seriesId] ?? Number.NEGATIVE_INFINITY,
      chapter.chapterNumber,
    );
  }
  return latest;
}

export function toChapterListItem(
  chapter: Chapter & { imageCount?: number },
): ChapterListItem {
  return {
    id: chapter.id,
    chapterNumber: chapter.chapterNumber,
    publicKey: chapter.publicKey,
    title: chapter.title,
    status: chapter.status,
    updatedAt: chapter.updatedAt,
    imageCount: chapter.imageCount ?? 0,
  };
}

export function sortChapters<T extends Chapter>(items: readonly T[]): T[] {
  return [...items].sort((left, right) =>
    left.chapterNumber === right.chapterNumber
      ? left.id.localeCompare(right.id)
      : right.chapterNumber - left.chapterNumber,
  );
}

export function filterChapters<T extends Chapter>(
  items: readonly T[],
  query: string,
): T[] {
  const value = query.trim().toLocaleLowerCase();
  if (!value) return [...items];
  return [...items].filter((chapter) =>
    `${chapter.chapterNumber} ${chapter.publicKey} ${chapter.title ?? ""}`
      .toLocaleLowerCase()
      .includes(value),
  );
}
