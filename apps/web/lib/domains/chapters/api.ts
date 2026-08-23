import { apiRequestBrowser } from "../../api/browser";
import type { Chapter, ChapterInput } from "./types";

export function listChapters(seriesId: string) {
  return apiRequestBrowser<Chapter[]>(`/series/${seriesId}/chapters`);
}

export function getChapter(chapterId: string) {
  return apiRequestBrowser<Chapter>(`/chapters/${chapterId}`);
}

export function createChapter(seriesId: string, input: ChapterInput) {
  return apiRequestBrowser<Chapter>(`/series/${seriesId}/chapters`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(input),
  });
}

export function updateChapter(chapterId: string, input: Partial<ChapterInput>) {
  return apiRequestBrowser<Chapter>(`/chapters/${chapterId}`, {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(input),
  });
}

export function deleteChapter(chapterId: string) {
  return apiRequestBrowser<void>(`/chapters/${chapterId}`, {
    method: "DELETE",
  });
}
