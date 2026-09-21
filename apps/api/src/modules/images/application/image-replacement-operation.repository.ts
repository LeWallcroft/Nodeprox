export const imageReplacementOperationStatuses = [
  "pending_upload",
  "uploaded",
  "completing",
  "completed",
  "failed",
] as const;

export type ImageReplacementOperationStatus =
  (typeof imageReplacementOperationStatuses)[number];

export type ImageReplacementOperation = {
  id: string;
  imageId: string;
  chapterId: string;
  requestedByUserId: string;
  candidateStorageKey: string;
  originalFilename: string;
  contentType: string;
  sizeBytes: number;
  status: ImageReplacementOperationStatus;
  resultImageVersionId: string | null;
  lastErrorCode: string | null;
  createdAt: Date;
  updatedAt: Date;
  completedAt: Date | null;
};

export type ImageReplacementCompletionClaim = {
  acquired: boolean;
  operation: ImageReplacementOperation | null;
};

export type ImageReplacementOperationRepository = {
  create(
    input: Omit<
      ImageReplacementOperation,
      | "createdAt"
      | "updatedAt"
      | "completedAt"
      | "resultImageVersionId"
      | "lastErrorCode"
    >,
  ): Promise<ImageReplacementOperation | null>;
  findById(id: string): Promise<ImageReplacementOperation | null>;
  markUploaded(
    id: string,
    updatedAt: Date,
  ): Promise<ImageReplacementOperation | null>;
  tryBeginCompletion(
    id: string,
    updatedAt: Date,
  ): Promise<ImageReplacementCompletionClaim>;
  markCompleted(input: {
    operationId: string;
    resultImageVersionId: string;
    completedAt: Date;
  }): Promise<ImageReplacementOperation | null>;
  markFailed(input: {
    operationId: string;
    errorCode: string;
    updatedAt: Date;
  }): Promise<ImageReplacementOperation | null>;
};
