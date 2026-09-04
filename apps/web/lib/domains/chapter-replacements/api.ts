import { apiRequestBrowser } from "../../api/browser";
import { putDirectUpload } from "../uploads/api";
import { normalizeSelectedZipFiles } from "../uploads/utils";
import type {
  ChapterReplacementProjection,
  PreparedChapterReplacement,
} from "./types";

export class ChapterReplacementFileError extends Error {}

export function validateChapterReplacementFile(file: File): File {
  const selection = normalizeSelectedZipFiles([file], { mode: "single" });
  const selected = selection.files[0];
  if (!selected)
    throw new ChapterReplacementFileError(
      selection.message ?? "Selecciona un archivo ZIP válido.",
    );
  return selected;
}

export function prepareChapterReplacement(input: {
  chapterId: string;
  file: File;
}): Promise<PreparedChapterReplacement> {
  const file = validateChapterReplacementFile(input.file);
  return apiRequestBrowser<PreparedChapterReplacement>(
    `/chapters/${input.chapterId}/replacement-session`,
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        filename: file.name,
        contentType: file.type || "application/zip",
        sizeBytes: file.size,
      }),
    },
  );
}

export function completeChapterReplacement(input: {
  chapterId: string;
  replacementId: string;
}): Promise<ChapterReplacementProjection> {
  return apiRequestBrowser<ChapterReplacementProjection>(
    `/chapters/${input.chapterId}/replacements/${input.replacementId}/complete`,
    { method: "POST" },
  );
}

export function getChapterReplacement(input: {
  chapterId: string;
  replacementId: string;
}): Promise<ChapterReplacementProjection> {
  return apiRequestBrowser<ChapterReplacementProjection>(
    `/chapters/${input.chapterId}/replacements/${input.replacementId}`,
  );
}

export async function startChapterReplacement(input: {
  chapterId: string;
  file: File;
  onUploadProgress?: (loadedBytes: number, totalBytes: number) => void;
}): Promise<ChapterReplacementProjection> {
  const file = validateChapterReplacementFile(input.file);
  const prepared = await prepareChapterReplacement({
    chapterId: input.chapterId,
    file,
  });
  await putDirectUpload(file, prepared.upload, (progress) =>
    input.onUploadProgress?.(progress.loadedBytes, progress.totalBytes),
  );
  return completeChapterReplacement({
    chapterId: input.chapterId,
    replacementId: prepared.replacementId,
  });
}
