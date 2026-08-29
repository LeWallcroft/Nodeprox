import { apiRequestBrowser } from "../../api/browser";
import type {
  Chapter,
  ChapterCapabilitiesProjection,
  ChapterHelper,
  ChapterInput,
  GlobalChapter,
  HelperCandidate,
} from "./types";

export function listChapters(seriesId: string) {
  return apiRequestBrowser<Chapter[]>(`/series/${seriesId}/chapters`);
}

export function listGlobalChapters() {
  return apiRequestBrowser<GlobalChapter[]>("/chapters");
}

export function listChapterHelpers(chapterId: string) {
  return apiRequestBrowser<ChapterHelper[]>(
    `/chapters/${chapterId}/permissions`,
  );
}

export function listHelperCandidates(chapterId: string) {
  return apiRequestBrowser<HelperCandidate[]>(
    `/chapters/${chapterId}/helper-candidates`,
  );
}

export function grantChapterHelper(chapterId: string, userId: string) {
  return apiRequestBrowser<void>(`/chapters/${chapterId}/permissions`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ userId, permissions: ["images.upload"] }),
  });
}

export function revokeChapterHelper(chapterId: string, userId: string) {
  return apiRequestBrowser<void>(
    `/chapters/${chapterId}/permissions/${userId}`,
    {
      method: "DELETE",
    },
  );
}

export function getChapter(chapterId: string) {
  return apiRequestBrowser<Chapter>(`/chapters/${chapterId}`);
}

export function getChapterCapabilities(chapterId: string) {
  return apiRequestBrowser<ChapterCapabilitiesProjection>(
    `/chapters/${chapterId}/capabilities`,
  );
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
