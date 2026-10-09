export type HealthStatus = "ok";
export type { AuditMetadata } from "./audit-metadata.js";
export {
  InvalidAuditMetadataError,
  sanitizeAuditMetadata,
} from "./audit-metadata.js";
export type {
  ChapterState,
  ChapterTransition,
  ChapterTransitionDecision,
  TransitionChapterStateInput,
  TransitionChapterStateResult,
} from "./chapter-state.js";
export {
  CHAPTER_STATES,
  CHAPTER_TRANSITIONS,
  evaluateChapterTransition,
} from "./chapter-state.js";

export interface RequestContext {
  requestId: string;
  /** Monotonic request-start marker used to record durable audit timing. */
  requestStartedAt?: number;
  /** The authenticated user when the request has been resolved. */
  actorId?: string;
  userId?: string;
  sessionId?: string;
  operationAudit?: OperationAuditContext;
  operationAuditRecorded?: boolean;
}

/**
 * Explicit business context for an operation that may be audited by the API
 * error boundary. It is set by the operation's presentation/application layer;
 * it is never inferred from an HTTP route.
 */
export interface OperationAuditContext {
  action: string;
  resourceType?: string;
  resourceId?: string;
  seriesId?: string;
  chapterId?: string;
}

export type ProcessChapterInput = {
  outboxId?: string;
  chapterId: string;
  seriesId: string;
  uploadId: string;
  sourceStorageKey: string;
  /** Correlation carried from the HTTP request through the durable outbox. */
  originRequestId?: string;
};
export interface ProcessingQueuePort {
  enqueueChapterProcessing(input: ProcessChapterInput): Promise<void>;
}

export type ValidateUploadInput = {
  outboxId: string;
  uploadId?: string;
  replacementId?: string;
  originRequestId?: string;
};

export interface AdmissionValidationQueuePort {
  enqueueAdmissionValidation(input: ValidateUploadInput): Promise<void>;
}

export type ProcessChapterReplacementInput = {
  outboxId?: string;
  replacementId: string;
  chapterId: string;
  originRequestId?: string;
};

export interface ChapterReplacementQueuePort {
  enqueueChapterReplacement(
    input: ProcessChapterReplacementInput,
  ): Promise<void>;
}

export type DeleteChapterStorageInput = {
  deletionId: string;
  chapterId: string;
  originRequestId?: string;
};

export interface ChapterDeletionQueuePort {
  enqueueChapterDeletion(input: DeleteChapterStorageInput): Promise<void>;
}

export type MediaWarning =
  | {
      code: "large-file";
      filename: string;
      sizeBytes: number;
      thresholdBytes?: number;
    }
  | {
      code: "wide-image";
      filename: string;
      width: number;
      thresholdWidth?: number;
    }
  | {
      code: "tall-image";
      filename: string;
      height: number;
      thresholdHeight?: number;
    };

export type ProblemCategory =
  | "validation"
  | "authentication"
  | "authorization"
  | "not_found"
  | "conflict"
  | "business_rule"
  | "rate_limit"
  | "external_dependency"
  | "internal";

export interface ProblemDetails {
  type: string;
  title: string;
  status: number;
  detail: string;
  instance?: string;
  code?: string;
  category?: ProblemCategory;
  requestId?: string;
  errors?: readonly unknown[];
}
