import { apiRequestBrowser } from "../../api/browser";
import { ApiError } from "../../api/types";
import type { InitiatedUpload, UploadProgress, UploadResult } from "./types";

export async function uploadChapter(
  chapterId: string,
  file: File,
  onProgress?: (progress: UploadProgress) => void,
): Promise<UploadResult> {
  const initiated = await apiRequestBrowser<InitiatedUpload>(
    `/chapters/${chapterId}/uploads/initiate`,
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        filename: file.name,
        contentType: "application/zip",
        sizeBytes: file.size,
      }),
    },
  );

  try {
    await putDirectUpload(file, initiated.transfer, onProgress);
    return await apiRequestBrowser<UploadResult>(
      `/chapters/${chapterId}/uploads/${initiated.uploadId}/complete`,
      { method: "POST" },
    );
  } catch (error) {
    await apiRequestBrowser<void>(
      `/chapters/${chapterId}/uploads/${initiated.uploadId}/abort`,
      { method: "POST" },
    ).catch(() => undefined);
    throw error;
  }
}

export function putDirectUpload(
  file: File,
  transfer: InitiatedUpload["transfer"],
  onProgress?: (progress: UploadProgress) => void,
): Promise<void> {
  if (transfer.mode !== "single")
    throw new ApiError(500, "The negotiated upload mode is not supported.");

  return new Promise((resolve, reject) => {
    const request = new XMLHttpRequest();
    request.open(transfer.method, transfer.url);
    for (const [name, value] of Object.entries(transfer.headers))
      request.setRequestHeader(name, value);
    request.upload.addEventListener("progress", (event) => {
      if (!event.lengthComputable) return;
      onProgress?.({ loadedBytes: event.loaded, totalBytes: event.total });
    });
    request.addEventListener("load", () => {
      if (request.status >= 200 && request.status < 300) {
        onProgress?.({ loadedBytes: file.size, totalBytes: file.size });
        resolve();
      } else {
        reject(
          new ApiError(
            502,
            "Backblaze B2 rejected the direct upload request.",
            "direct-upload-failed",
          ),
        );
      }
    });
    request.addEventListener("error", () =>
      reject(
        new ApiError(
          502,
          "The direct upload could not reach Backblaze B2.",
          "direct-upload-unavailable",
        ),
      ),
    );
    request.addEventListener("abort", () =>
      reject(new ApiError(499, "The direct upload was cancelled.")),
    );
    request.send(file);
  });
}
