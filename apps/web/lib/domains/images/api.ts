import { apiRequestBrowser } from "../../api/browser";
import { putDirectUpload } from "../uploads/api";
import type {
  CanonicalImageReplacementResult,
  ImageReplacementPhase,
  PreparedImageReplacement,
} from "./types";

const supportedImageContentTypes = new Set([
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/gif",
]);

export class ImageReplacementFileValidationError extends Error {
  constructor() {
    super("The selected file is not supported for image replacement.");
    this.name = "ImageReplacementFileValidationError";
  }
}

export function selectSingleImageReplacementFile(files: readonly File[]): File {
  if (files.length !== 1) throw new ImageReplacementFileValidationError();
  const file = files[0];
  if (file === undefined) throw new ImageReplacementFileValidationError();
  return validateImageReplacementFile(file);
}

export function validateImageReplacementFile(file: File): File {
  const contentType = normalizeImageContentType(file.type);
  if (
    !supportedImageContentTypes.has(contentType) ||
    !Number.isSafeInteger(file.size) ||
    file.size <= 0
  )
    throw new ImageReplacementFileValidationError();
  return file;
}

export async function prepareImageReplacement(input: {
  chapterId: string;
  imageId: string;
  file: File;
}): Promise<PreparedImageReplacement> {
  const file = validateImageReplacementFile(input.file);
  return apiRequestBrowser<PreparedImageReplacement>(
    `/chapters/${input.chapterId}/images/${input.imageId}/replacement-session`,
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        filename: file.name,
        contentType: normalizeImageContentType(file.type),
        sizeBytes: file.size,
      }),
    },
  );
}

export function completeImageReplacement(input: {
  chapterId: string;
  imageId: string;
  replacementId: string;
}): Promise<CanonicalImageReplacementResult> {
  return apiRequestBrowser<CanonicalImageReplacementResult>(
    `/chapters/${input.chapterId}/images/${input.imageId}/replacements/${input.replacementId}/complete`,
    { method: "POST" },
  );
}

export async function replaceChapterImage(input: {
  chapterId: string;
  imageId: string;
  file: File;
  onPhase?: (
    phase: Exclude<ImageReplacementPhase, "idle" | "success" | "error">,
  ) => void;
}): Promise<CanonicalImageReplacementResult> {
  const file = validateImageReplacementFile(input.file);
  input.onPhase?.("preparing");
  const prepared = await prepareImageReplacement({
    chapterId: input.chapterId,
    imageId: input.imageId,
    file,
  });
  input.onPhase?.("uploading");
  await putDirectUpload(file, prepared.upload);
  input.onPhase?.("completing");
  return completeImageReplacement({
    chapterId: input.chapterId,
    imageId: input.imageId,
    replacementId: prepared.replacementId,
  });
}

function normalizeImageContentType(value: string): string {
  return value.split(";", 1)[0]?.trim().toLowerCase() ?? "";
}
