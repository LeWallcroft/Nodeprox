export type HealthStatus = "ok";

export interface RequestContext {
  requestId: string;
  userId?: string;
  sessionId?: string;
}

export type ProcessChapterInput = {
  chapterId: string;
  seriesId: string;
  uploadId: string;
  sourceStorageKey: string;
};
export interface ProcessingQueuePort {
  enqueueChapterProcessing(input: ProcessChapterInput): Promise<void>;
}

export interface ProblemDetails {
  type: string;
  title: string;
  status: number;
  detail: string;
  instance?: string;
  code?: string;
  requestId?: string;
  errors?: readonly unknown[];
}
