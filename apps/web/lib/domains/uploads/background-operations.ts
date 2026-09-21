import { apiRequestBrowser } from "../../api/browser";

export type BackgroundUploadOperation = {
  id: string;
  kind: "chapter_import" | "chapter_replacement" | "image_replacement";
  seriesId: string;
  seriesTitle: string;
  chapterId: string | null;
  chapterNumber: number | null;
  imageId: string | null;
  filename: string;
  status:
    | "pending"
    | "pending_upload"
    | "uploading"
    | "uploaded"
    | "processing"
    | "ready"
    | "completing"
    | "completed"
    | "failed";
  errorCode: string | null;
  createdAt: string;
  updatedAt: string;
  completedAt: string | null;
};

export function listBackgroundUploadOperations() {
  return apiRequestBrowser<{ items: BackgroundUploadOperation[] }>(
    "/me/upload-operations?limit=100",
  );
}
