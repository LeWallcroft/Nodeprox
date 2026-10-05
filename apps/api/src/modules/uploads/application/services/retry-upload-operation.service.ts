import type { StorageExecutionResolver } from "@nodeprox/storage/profile-execution";
import type { AuthorizationContext } from "../../../authorization/domain/authorization.types.js";
import type { ChapterPermissionService } from "../../../chapters/application/services/chapter-permission.service.js";

export type RetryableUploadKind =
  | "chapter_import"
  | "chapter_upload"
  | "chapter_replacement";
export type RetryableUploadOperation = {
  kind: RetryableUploadKind;
  id: string;
  chapterId: string;
  storageKey: string;
  storageProfileId: string;
  stage: "admission" | "processing";
  status: string;
};

export interface RetryUploadOperationRepositoryPort {
  find(
    kind: RetryableUploadKind,
    id: string,
  ): Promise<RetryableUploadOperation | null>;
  requeue(
    operation: RetryableUploadOperation,
    requestId?: string,
  ): Promise<boolean>;
  report(
    kind: RetryableUploadKind,
    id: string,
  ): Promise<{
    validationRunId: string;
    requestId: string | null;
    status: string;
    issues: readonly {
      code: string;
      severity: string;
      fileIndex: number | null;
      filename: string | null;
      actual: Record<string, unknown> | null;
      expected: Record<string, unknown> | null;
    }[];
  } | null>;
}

export class RetryUploadOperationNotFoundError extends Error {}
export class RetryUploadOperationDeniedError extends Error {}
export class RetryUploadOperationConflictError extends Error {}
export class RetryUploadSourceMissingError extends Error {}

export class RetryUploadOperationService {
  constructor(
    private readonly permissions: ChapterPermissionService,
    private readonly repository: RetryUploadOperationRepositoryPort,
    private readonly storageExecution: StorageExecutionResolver,
  ) {}

  async retryUploadOperation(input: {
    context: AuthorizationContext;
    kind: RetryableUploadKind;
    operationId: string;
    requestId?: string;
  }): Promise<{
    status: "validating" | "uploaded";
    stage: "admission" | "processing";
  }> {
    const operation = await this.authorizedOperation(input);
    if (operation.status !== "retry_exhausted")
      throw new RetryUploadOperationConflictError();
    const storage = await this.storageExecution.storageFor(
      operation.storageProfileId,
    );
    if (!(await storage.exists(operation.storageKey)))
      throw new RetryUploadSourceMissingError();
    if (!(await this.repository.requeue(operation, input.requestId)))
      throw new RetryUploadOperationConflictError();
    return {
      status: operation.stage === "admission" ? "validating" : "uploaded",
      stage: operation.stage,
    };
  }

  async report(input: {
    context: AuthorizationContext;
    kind: RetryableUploadKind;
    operationId: string;
  }) {
    await this.authorizedOperation(input);
    return this.repository.report(input.kind, input.operationId);
  }

  private async authorizedOperation(input: {
    context: AuthorizationContext;
    kind: RetryableUploadKind;
    operationId: string;
  }) {
    const operation = await this.repository.find(input.kind, input.operationId);
    if (!operation) throw new RetryUploadOperationNotFoundError();
    const decision = await this.permissions.check({
      context: input.context,
      chapterId: operation.chapterId,
      permission:
        input.kind === "chapter_replacement"
          ? "chapters.replace"
          : "images.upload",
    });
    if (decision.reason === "not-found")
      throw new RetryUploadOperationNotFoundError();
    if (!decision.allowed) throw new RetryUploadOperationDeniedError();
    return operation;
  }
}
