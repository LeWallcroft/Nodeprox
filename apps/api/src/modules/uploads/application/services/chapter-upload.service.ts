import type { AuthorizationContext } from "../../../authorization/domain/authorization.types.js";
import type { ChapterPermissionService } from "../../../chapters/application/services/chapter-permission.service.js";
import { randomUUID } from "node:crypto";
import {
  UploadTooLargeError,
  validateUploadMetadata,
} from "../../domain/upload.policy.js";
import type { ChapterUploadResult } from "../../domain/upload.types.js";
import type { StoragePort } from "../ports/storage.ports.js";
import type {
  UploadAuditPort,
  UploadRepositoryPort,
} from "../ports/upload.ports.js";

export class ChapterUploadService {
  constructor(
    private readonly permissions: ChapterPermissionService,
    private readonly uploads: UploadRepositoryPort,
    private readonly storage: StoragePort,
    private readonly audit: UploadAuditPort,
    private readonly maxSizeBytes: number,
  ) {}

  async upload(input: {
    context: AuthorizationContext;
    chapterId: string;
    file: {
      stream: NodeJS.ReadableStream;
      filename: string;
      contentType: string;
      sizeBytes: number;
      magicBytes: Uint8Array;
      isTruncated?: () => boolean;
    };
  }): Promise<ChapterUploadResult> {
    const decision = await this.permissions.check({
      context: input.context,
      chapterId: input.chapterId,
      permission: "images.upload",
    });
    if (decision.reason === "not-found")
      return Promise.reject(new UploadNotFoundError());
    if (!decision.allowed) return Promise.reject(new UploadDeniedError());
    const metadata = validateUploadMetadata({
      filename: input.file.filename,
      contentType: input.file.contentType,
      sizeBytes: input.file.sizeBytes,
      maxSizeBytes: this.maxSizeBytes,
      magicBytes: input.file.magicBytes,
    });
    if (await this.uploads.findActiveByChapterId(input.chapterId))
      throw new UploadConflictError();

    const uploadId = randomUUID();
    const storageKey = `chapters/${input.chapterId}/uploads/${uploadId}.zip`;
    await this.uploads.createPending({
      id: uploadId,
      chapterId: input.chapterId,
      storageKey,
      originalFilename: metadata.filename,
      contentType: input.file.contentType,
      createdBy: input.context.userId,
    });
    await this.safeAudit(
      input.context.userId,
      "chapter.upload.started",
      input.chapterId,
    );

    try {
      const stored = await this.storage.put({
        key: storageKey,
        body: input.file.stream,
        contentType: input.file.contentType,
        sizeBytes: input.file.sizeBytes,
      });
      if (stored.sizeBytes > this.maxSizeBytes || input.file.isTruncated?.()) {
        await this.storage.delete(storageKey);
        await this.uploads.removePending(uploadId);
        throw new UploadTooLargeError();
      }
      await this.uploads.markUploaded(uploadId, stored);
      await this.safeAudit(
        input.context.userId,
        "chapter.upload.completed",
        input.chapterId,
      );
      return {
        chapterId: input.chapterId,
        uploadId,
        status: "uploaded",
        filename: metadata.filename,
        sizeBytes: stored.sizeBytes,
      };
    } catch (error) {
      try {
        await this.storage.delete(storageKey);
        await this.uploads.removePending(uploadId);
      } catch {
        // Compensation is best-effort; the failure is recorded without sensitive data.
      }
      await this.safeAudit(
        input.context.userId,
        "chapter.upload.failed",
        input.chapterId,
      );
      throw error;
    }
  }

  private async safeAudit(actorId: string, action: string, chapterId: string) {
    try {
      await this.audit.append({
        actorId,
        action,
        resourceType: "chapter",
        resourceId: chapterId,
        metadata: {
          result: action.endsWith("completed")
            ? "completed"
            : action.endsWith("started")
              ? "started"
              : "failed",
        },
      });
    } catch {
      // Audit failure must not expose storage or credential details.
    }
  }
}

export class UploadDeniedError extends Error {}
export class UploadNotFoundError extends Error {}
export class UploadConflictError extends Error {}
