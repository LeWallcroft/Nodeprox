export type PerformanceStageName =
  | "processing.preflight"
  | "processing.claim"
  | "processing.zip.fetch_extract"
  | "processing.manifest_match"
  | "processing.image.reserve"
  | "processing.image.persist_verify"
  | "storage.put_with_existence_check"
  | "storage.verify_head"
  | "storage.verify_get_sha256"
  | "processing.db_finalize"
  | "processing.audit"
  | "processing.cleanup"
  | "admission.begin"
  | "admission.zip.fetch_inspect"
  | "admission.settle";

export type StageOutcome = "success" | "error" | "expected_existing";
export type JobOutcome = "success" | "error";
export type WorkOutcome =
  | "processed"
  | "skipped"
  | "accepted"
  | "rejected"
  | "failed"
  | "unknown";
export type WorkSkipReason =
  | "invalid-upload"
  | "already-ready"
  | "claim-unavailable"
  | "admission-not-claimed";

export type TimingSample = Readonly<{
  stage: PerformanceStageName;
  durationMs: number;
  outcome: StageOutcome;
  bytes?: number;
  objectOutcome?: "created" | "existing-equivalent" | "existing-conflict";
}>;

export type StageAggregate = Readonly<{
  count: number;
  totalMs: number;
  maxMs: number;
  errorCount: number;
  bytes: number;
  createdCount: number;
  reusedCount: number;
  conflictCount: number;
}>;

export type InvocationResult = Readonly<{
  jobName: "chapter.process" | "chapter.upload.validate";
  jobId: string;
  jobAttempt: number;
  outcome: JobOutcome;
  handlerDurationMs: number;
}>;

export interface PerformanceObserverPort {
  readonly enabled: boolean;
  record(sample: TimingSample): void;
  markWorkOutcome?(outcome: WorkOutcome, reason?: WorkSkipReason): void;
  finish(result: InvocationResult): void;
}
