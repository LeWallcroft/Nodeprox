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
