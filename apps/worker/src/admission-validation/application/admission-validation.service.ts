import type { StorageExecutionResolver } from "@nodeprox/storage/profile-execution";
import { StorageError } from "@nodeprox/storage/errors";
import type { ChapterZipInspector } from "../infrastructure/zip/chapter-zip.inspector.js";
import type {
  AdmissionOwner,
  AdmissionValidationRepositoryPort,
} from "./ports.js";

export class AdmissionTechnicalFailure extends Error {
  constructor(
    readonly retryable: boolean,
    readonly code: string,
  ) {
    super(code);
  }
}

export class AdmissionValidationService {
  constructor(
    private readonly repository: AdmissionValidationRepositoryPort,
    private readonly storageExecution: StorageExecutionResolver,
    private readonly inspector: ChapterZipInspector,
  ) {}

  async validate(
    input: AdmissionOwner & {
      jobId: string;
      jobAttempt: number;
      finalAttempt: boolean;
      requestId?: string;
    },
  ): Promise<void> {
    const claim = await this.repository.begin(input);
    if (!claim) return;
    try {
      const storage = await this.storageExecution.storageFor(
        claim.storageProfileId,
      );
      const source = await storage.get(claim.sourceStorageKey);
      const result = await this.inspector.inspect(source);
      await this.repository.settle(claim.runId, result);
    } catch (error) {
      const storageError = error instanceof StorageError ? error : null;
      const retryable = storageError?.retryable ?? true;
      const disposition = retryable
        ? input.finalAttempt
          ? "retry_exhausted"
          : "retryable"
        : "terminal";
      await this.repository.fail(claim.runId, {
        disposition,
        code: storageError?.code ?? "ADMISSION_TECHNICAL_FAILURE",
        ...(storageError?.providerCode
          ? { providerCode: storageError.providerCode }
          : {}),
      });
      throw new AdmissionTechnicalFailure(
        retryable,
        storageError?.code ?? "ADMISSION_TECHNICAL_FAILURE",
      );
    }
  }
}
