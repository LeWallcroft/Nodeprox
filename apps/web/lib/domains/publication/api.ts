import { apiRequestBrowser } from "../../api/browser";
import type { PublicChapter } from "./types";

export function getPublicChapter(chapterId: string) {
  return apiRequestBrowser<PublicChapter>(`/public/chapters/${chapterId}`);
}
