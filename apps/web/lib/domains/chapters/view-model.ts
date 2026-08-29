import type { Chapter } from "./types";

export interface ChapterListItem {
  id: string;
  chapterNumber: number;
  publicKey: string;
  title: string | null;
  status: Chapter["status"];
  updatedAt: string;
}

export function toChapterListItem(chapter: Chapter): ChapterListItem {
  return {
    id: chapter.id,
    chapterNumber: chapter.chapterNumber,
    publicKey: chapter.publicKey,
    title: chapter.title,
    status: chapter.status,
    updatedAt: chapter.updatedAt,
  };
}

export function sortChapters(items: readonly Chapter[]) {
  return [...items].sort((left, right) =>
    left.chapterNumber === right.chapterNumber
      ? left.id.localeCompare(right.id)
      : right.chapterNumber - left.chapterNumber,
  );
}

export function filterChapters(items: readonly Chapter[], query: string) {
  const value = query.trim().toLocaleLowerCase();
  if (!value) return items;
  return items.filter((chapter) =>
    `${chapter.chapterNumber} ${chapter.publicKey} ${chapter.title ?? ""}`
      .toLocaleLowerCase()
      .includes(value),
  );
}
