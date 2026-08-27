export interface UploadResult {
  chapterId: string;
  uploadId: string;
  status: "uploaded";
  filename: string;
  sizeBytes: number;
}

export interface InitiatedUpload {
  chapterId: string;
  uploadId: string;
  status: "pending";
  filename: string;
  sizeBytes: number;
  transfer:
    | {
        mode: "single";
        method: "PUT";
        url: string;
        headers: Readonly<Record<string, string>>;
        expiresAt: string;
      }
    | {
        mode: "multipart";
        partSizeBytes: number;
        parts: readonly {
          partNumber: number;
          method: "PUT";
          url: string;
          headers: Readonly<Record<string, string>>;
        }[];
        expiresAt: string;
      };
}

export interface UploadProgress {
  loadedBytes: number;
  totalBytes: number;
}
