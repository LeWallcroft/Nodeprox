import { apiRequestBrowser } from "../../api/browser";
import type {
  CreatedImportBatch,
  ImportBatchProjection,
  RetriedImportItem,
} from "./types";

export function createImportBatch(
  seriesId: string,
  items: readonly {
    clientId: string;
    chapterNumber: number;
    filename: string;
    contentType: string;
    sizeBytes: number;
  }[],
) {
  return apiRequestBrowser<CreatedImportBatch>(
    `/series/${seriesId}/import-batches`,
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ items }),
    },
  );
}

export function getImportBatch(batchId: string) {
  return apiRequestBrowser<ImportBatchProjection>(`/import-batches/${batchId}`);
}

export function completeImportItem(chapterId: string, uploadId: string) {
  return apiRequestBrowser(
    `/chapters/${chapterId}/uploads/${uploadId}/complete`,
    { method: "POST" },
  );
}

export function abortImportItem(chapterId: string, uploadId: string) {
  return apiRequestBrowser<void>(
    `/chapters/${chapterId}/uploads/${uploadId}/abort`,
    { method: "POST" },
  );
}

export function retryImportItem(
  seriesId: string,
  batchId: string,
  itemId: string,
  input: { contentType: string; sizeBytes: number },
) {
  return apiRequestBrowser<RetriedImportItem>(
    `/series/${seriesId}/import-batches/${batchId}/items/${itemId}/retry`,
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(input),
    },
  );
}
