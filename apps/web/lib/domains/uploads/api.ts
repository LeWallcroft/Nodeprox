import { apiRequestBrowser } from "../../api/browser";
import type { UploadResult } from "./types";

export function uploadChapter(chapterId: string, file: File) {
  const formData = new FormData();
  formData.append("file", file, file.name);
  return apiRequestBrowser<UploadResult>(`/chapters/${chapterId}/upload`, {
    method: "POST",
    body: formData,
  });
}
