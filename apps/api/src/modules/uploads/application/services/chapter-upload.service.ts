import { randomUUID } from "node:crypto";
import {
  UploadTransferObjectNotFoundError,
  UploadTransferProviderError,
  type VerifiedUploadedObject,
} from "@nodeprox/storage/port";
import type {
  ActiveStorageProfilePort,
  StorageExecutionResolver,
} from "@nodeprox/storage/profile-execution";
import type { AuthorizationContext } from "../../../authorization/domain/authorization.types.js";
import type { ChapterPermissionService } from "../../../chapters/application/services/chapter-permission.service.js";
import { validateUploadMetadata } from "../../domain/upload.policy.js";
import type {
  ChapterUploadResult,
  InitiatedChapterUpload,
} from "../../domain/upload.types.js";
import type {
  UploadAuditPort,
  UploadLifecycleBoundaryPort,
  UploadRepositoryPort,
} from "../ports/upload.ports.js";

const GRANT_TTL_SECONDS = 15 * 60;

export class ChapterUploadService {
  constructor(
    private readonly permissions: ChapterPermissionService,
    private readonly uploads: UploadRepositoryPort,
    private readonly lifecycle: UploadLifecycleBoundaryPort,
    private readonly storageExecution: StorageExecutionResolver,
    private readonly activeProfile: ActiveStorageProfilePort,
    private readonly audit: UploadAuditPort,
    private readonly maxSizeBytes: number,
    private readonly logger?: { error(context: object, message: string): void },
  ) {}

  async initiate(input: {
    context: AuthorizationContext;
    chapterId: string;
    filename: string;
    contentType: string;
    sizeBytes: number;
    originRequestId?: string;
  }): Promise<InitiatedChapterUpload> {
    const decision = await this.authorize(input.context, input.chapterId);
    const metadata = validateUploadMetadata({
      filename: input.filename,
      contentType: input.contentType,
      sizeBytes: input.sizeBytes,
      maxSizeBytes: this.maxSizeBytes,
    });
    const uploadId = randomUUID();
    const storageKey = `uploads/${decision.seriesId}/${input.chapterId}/${uploadId}.zip`;
    const storageProfileId =
      await this.activeProfile.getActiveStorageProfileId();
    const pending = await this.uploads.createPending({
      id: uploadId,
      chapterId: input.chapterId,
      storageKey,
      storageProfileId,
      originalFilename: metadata.filename,
      contentType: metadata.contentType,
      sizeBytes: input.sizeBytes,
      createdBy: input.context.userId,
    });
    if (!pending) throw new UploadConflictError();

    try {
      const transfer =
        await this.storageExecution.uploadTransferFor(storageProfileId);
      const grant = await transfer.initiate({
        key: storageKey,
        contentType: metadata.contentType,
        sizeBytes: input.sizeBytes,
        expiresInSeconds: GRANT_TTL_SECONDS,
      });
      await this.safeAudit(
        input.context.userId,
        "chapter.upload.initiated",
        input.chapterId,
        "pending",
        input.originRequestId,
      );
      return {
        chapterId: input.chapterId,
        uploadId,
        status: "pending",
        filename: metadata.filename,
        sizeBytes: input.sizeBytes,
        transfer: grant,
      };
    } catch (error) {
      await this.uploads
        .removePending(uploadId)
        .catch((cleanupError: unknown) => {
          this.logOperationalFailure(
            "upload-pending-cleanup-failed",
            uploadId,
            cleanupError,
          );
          return false;
        });
      await this.safeAudit(
        input.context.userId,
        "chapter.upload.failed",
        input.chapterId,
        "failed",
        input.originRequestId,
      );
      if (error instanceof UploadTransferProviderError)
        throw new UploadProviderUnavailableError();
      throw error;
    }
  }

  async complete(input: {
    context: AuthorizationContext;
    chapterId: string;
    uploadId: string;
    originRequestId?: string;
  }): Promise<ChapterUploadResult> {
    await this.authorize(input.context, input.chapterId);
    const upload = await this.uploads.claimForCompletion(
      input.uploadId,
      input.chapterId,
    );
    if (!upload) throw new UploadConflictError();

    let verified: VerifiedUploadedObject;
    try {
      const transfer = await this.storageExecution.uploadTransferFor(
        upload.storageProfileId,
      );
      verified = await transfer.verify({ key: upload.storageKey });
    } catch (error) {
      await this.releaseCompletion(upload.id);
      if (error instanceof UploadTransferObjectNotFoundError) {
        await this.safeAudit(
          input.context.userId,
          "chapter.upload.completed",
          input.chapterId,
          "failed",
          input.originRequestId,
        );
        throw new UploadedObjectNotFoundError();
      }
      if (error instanceof UploadTransferProviderError)
        throw new UploadProviderUnavailableError();
      throw error;
    }
    const mismatch =
      verified.key !== upload.storageKey ||
      verified.sizeBytes <= 0 ||
      verified.sizeBytes !== upload.sizeBytes ||
      (verified.contentType !== undefined &&
        normalizeContentType(verified.contentType) !==
          normalizeContentType(upload.contentType));
    if (mismatch) {
      await this.releaseCompletion(upload.id);
      throw new UploadedObjectMismatchError();
    }

    let finalization: Awaited<
      ReturnType<UploadLifecycleBoundaryPort["finalizeIfAuthorized"]>
    >;
    try {
      finalization = await this.lifecycle.finalizeIfAuthorized({
        actor: input.context,
        chapterId: input.chapterId,
        uploadId: input.uploadId,
        verifiedObject: verified,
        ...(input.originRequestId
          ? { originRequestId: input.originRequestId }
          : {}),
      });
    } catch (error) {
      await this.releaseCompletion(upload.id);
      throw error;
    }
    if (finalization.outcome !== "validating") {
      await this.releaseCompletion(upload.id);
      if (finalization.outcome === "denied") throw new UploadDeniedError();
      throw new UploadConflictError();
    }
    await this.safeAudit(
      input.context.userId,
      "chapter.upload.completed",
      input.chapterId,
      "completed",
      input.originRequestId,
    );
    return {
      chapterId: input.chapterId,
      uploadId: upload.id,
      status: "validating",
      filename: upload.originalFilename,
      sizeBytes: verified.sizeBytes,
    };
  }

  async abort(input: {
    context: AuthorizationContext;
    chapterId: string;
    uploadId: string;
  }): Promise<void> {
    await this.authorize(input.context, input.chapterId);
    const claim = await this.lifecycle.claimAbortIfAuthorized({
      actor: input.context,
      chapterId: input.chapterId,
      uploadId: input.uploadId,
    });
    if (claim.outcome === "denied") throw new UploadDeniedError();
    if (claim.outcome === "conflict") throw new UploadConflictError();
    const upload = claim.upload;
    try {
      const transfer = await this.storageExecution.uploadTransferFor(
        upload.storageProfileId,
      );
      await transfer.abort({ key: upload.storageKey });
    } catch (error) {
      await this.releaseAbort(upload.id);
      if (error instanceof UploadTransferProviderError)
        throw new UploadProviderUnavailableError();
      throw error;
    }
    if (!(await this.uploads.removeAborting(upload.id)))
      throw new UploadConflictError();
    await this.safeAudit(
      input.context.userId,
      "chapter.upload.aborted",
      input.chapterId,
      "aborted",
    );
  }

  async cleanupStale(cutoff: Date, limit = 20): Promise<number> {
    await this.uploads.recoverStaleClaims(cutoff);
    const stale = await this.uploads.findStalePending(cutoff, limit);
    let cleaned = 0;
    for (const candidate of stale) {
      const upload = await this.uploads.claimForAbort(
        candidate.id,
        candidate.chapterId,
      );
      if (!upload) continue;
      try {
        const transfer = await this.storageExecution.uploadTransferFor(
          upload.storageProfileId,
        );
        await transfer.abort({ key: upload.storageKey });
        if (!(await this.uploads.removeAborting(upload.id))) continue;
        cleaned += 1;
        await this.safeAudit(
          upload.createdBy,
          "chapter.upload.expired",
          upload.chapterId,
          "expired",
        );
      } catch (error) {
        this.logOperationalFailure(
          "stale-upload-cleanup-failed",
          upload.id,
          error,
        );
        await this.releaseAbort(upload.id);
      }
    }
    return cleaned;
  }

  private async authorize(context: AuthorizationContext, chapterId: string) {
    const decision = await this.permissions.check({
      context,
      chapterId,
      permission: "images.upload",
    });
    if (decision.reason === "not-found") throw new UploadNotFoundError();
    if (!decision.allowed) throw new UploadDeniedError();
    return decision;
  }

  private async safeAudit(
    actorId: string,
    action: string,
    chapterId: string,
    result: "pending" | "completed" | "aborted" | "expired" | "failed",
    requestId?: string,
  ) {
    try {
      await this.audit.append({
        actorId,
        action,
        resourceType: "chapter",
        resourceId: chapterId,
        result:
          result === "failed"
            ? "failed"
            : result === "pending"
              ? null
              : "success",
        ...(requestId ? { requestId } : {}),
        metadata: { result },
      });
    } catch (error) {
      this.logOperationalFailure("upload-audit-failed", chapterId, error);
    }
  }

  private async releaseCompletion(uploadId: string) {
    await this.uploads.releaseCompletion(uploadId).catch((error: unknown) => {
      this.logOperationalFailure(
        "upload-completion-release-failed",
        uploadId,
        error,
      );
    });
  }

  private async releaseAbort(uploadId: string) {
    await this.uploads.releaseAbort(uploadId).catch((error: unknown) => {
      this.logOperationalFailure(
        "upload-abort-release-failed",
        uploadId,
        error,
      );
    });
  }

  private logOperationalFailure(
    event: string,
    uploadId: string,
    error: unknown,
  ) {
    this.logger?.error(
      {
        event,
        uploadId,
        errorName: error instanceof Error ? error.name : "unknown",
      },
      "Upload operational failure",
    );
  }
}

function normalizeContentType(value: string): string {
  return value.split(";", 1)[0]?.trim().toLowerCase() ?? "";
}

export class UploadDeniedError extends Error {}
export class UploadNotFoundError extends Error {}
export class UploadConflictError extends Error {}
export class UploadedObjectNotFoundError extends Error {}
export class UploadedObjectMismatchError extends Error {}
export class UploadProviderUnavailableError extends Error {}
