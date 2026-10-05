export type UploadOperationKind =
  | "chapter_import"
  | "chapter_upload"
  | "chapter_replacement"
  | "image_replacement";

export type UploadOperationStatus =
  | "pending"
  | "pending_upload"
  | "uploading"
  | "validating"
  | "rejected"
  | "retry_exhausted"
  | "terminal_failed"
  | "uploaded"
  | "processing"
  | "ready"
  | "completing"
  | "completed"
  | "failed";

export type UploadOperationProjection = {
  id: string;
  kind: UploadOperationKind;
  seriesId: string;
  seriesTitle: string;
  chapterId: string | null;
  chapterNumber: number | null;
  imageId: string | null;
  filename: string;
  status: UploadOperationStatus;
  errorCode: string | null;
  failureStage: "admission" | "storage" | "processing" | "database" | null;
  createdAt: Date;
  updatedAt: Date;
  completedAt: Date | null;
};

export interface UploadOperationReadRepository {
  listForUser(input: {
    userId: string;
    limit: number;
  }): Promise<UploadOperationProjection[]>;
}

export class ListUploadOperationsService {
  constructor(private readonly repository: UploadOperationReadRepository) {}

  execute(input: { userId: string; limit?: number }) {
    return this.repository.listForUser({
      userId: input.userId,
      limit: Math.max(1, Math.min(input.limit ?? 50, 100)),
    });
  }
}
