import { randomUUID } from "node:crypto";
import {
  UploadTransferObjectNotFoundError,
  type UploadTransferPort,
  UploadTransferProviderError,
  type VerifiedUploadedObject,
} from "@nodeprox/storage/port";
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
    private readonly transfer: UploadTransferPort,
    private readonly audit: UploadAuditPort,
    private readonly maxSizeBytes: number,
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
    const pending = await this.uploads.createPending({
      id: uploadId,
      chapterId: input.chapterId,
      storageKey,
      originalFilename: metadata.filename,
      contentType: metadata.contentType,
      sizeBytes: input.sizeBytes,
      createdBy: input.context.userId,
    });
    if (!pending) throw new UploadConflictError();

    try {
      const grant = await this.transfer.initiate({
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
      await this.uploads.removePending(uploadId).catch(() => false);
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
      verified = await this.transfer.verify({ key: upload.storageKey });
    } catch (error) {
      await this.uploads.releaseCompletion(upload.id).catch(() => undefined);
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
      await this.uploads.releaseCompletion(upload.id).catch(() => undefined);
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
      await this.uploads.releaseCompletion(upload.id).catch(() => undefined);
      throw error;
    }
    if (finalization.outcome !== "uploaded") {
      await this.uploads.releaseCompletion(upload.id).catch(() => undefined);
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
      status: "uploaded",
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
      await this.transfer.abort({ key: upload.storageKey });
    } catch (error) {
      await this.uploads.releaseAbort(upload.id).catch(() => undefined);
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
        await this.transfer.abort({ key: upload.storageKey });
        if (!(await this.uploads.removeAborting(upload.id))) continue;
        cleaned += 1;
        await this.safeAudit(
          upload.createdBy,
          "chapter.upload.expired",
          upload.chapterId,
          "expired",
        );
      } catch {
        await this.uploads.releaseAbort(upload.id).catch(() => undefined);
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
    } catch {
      // Audit persistence must not leak provider or credential details.
    }
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
