export interface UploadResult {
  chapterId: string;
  uploadId: string;
  status: "uploaded";
  filename: string;
  sizeBytes: number;
}
