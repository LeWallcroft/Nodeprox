import type { AdmissionValidationResult } from "../domain/admission-validation.types.js";

export type AdmissionOwner =
  | { uploadId: string; replacementId?: never }
  | { replacementId: string; uploadId?: never };

export type AdmissionClaim = {
  runId: string;
  sourceStorageKey: string;
  storageProfileId: string;
  chapterId: string;
  requestId?: string;
};

export interface AdmissionValidationRepositoryPort {
  begin(
    input: AdmissionOwner & {
      jobId: string;
      jobAttempt: number;
      requestId?: string;
    },
  ): Promise<AdmissionClaim | null>;
  settle(runId: string, result: AdmissionValidationResult): Promise<void>;
  fail(
    runId: string,
    failure: {
      disposition: "retryable" | "retry_exhausted" | "terminal";
      code: string;
      providerCode?: string;
    },
  ): Promise<void>;
}
