import { and, eq, isNull, lte, sql } from "drizzle-orm";
import type { NodeProxDatabase } from "../../../../../../../../database/client.js";
import {
  auditLogs,
  chapterImportItems,
  chapterPermissions,
  chapters,
  processingOutbox,
  series,
  seriesAssignments,
  uploads,
} from "../../../../../../../../database/schema/index.js";
import type { AuthorizationAuditRepository } from "../../../../authorization/application/ports/authorization.ports.js";
import { PERMISSIONS } from "../../../../authorization/domain/permissions.js";
import { sanitizeAuditMetadata } from "../../../../authorization/infrastructure/audit/audit-metadata.js";
import {
  lockCurrentAuthorization,
  type NodeProxTransaction,
} from "../../../../authorization/infrastructure/persistence/drizzle/transactional-authorization.js";
import { evaluateChapterContextualAuthorization } from "../../../../chapters/domain/chapter-permission.policy.js";
import type { ProcessingOutboxPort } from "../../../../processing/application/ports.js";
import type {
  UploadAuditPort,
  UploadLifecycleBoundaryPort,
  UploadRepositoryPort,
} from "../../../application/ports/upload.ports.js";
import type { UploadRecord } from "../../../domain/upload.types.js";

const toRecord = (row: typeof uploads.$inferSelect): UploadRecord => ({
  id: row.id,
  chapterId: row.chapterId,
  storageKey: row.storageKey,
  originalFilename: row.originalFilename,
  contentType: row.contentType,
  sizeBytes: row.sizeBytes,
  etag: row.etag,
  status: row.status,
  createdBy: row.createdBy,
  createdAt: row.createdAt,
  updatedAt: row.updatedAt,
});

export class DrizzleUploadRepository
  implements
    UploadRepositoryPort,
    UploadLifecycleBoundaryPort,
    UploadAuditPort,
    AuthorizationAuditRepository,
    ProcessingOutboxPort
{
  constructor(private readonly db: NodeProxDatabase) {}

  async createPending(input: {
    id: string;
    chapterId: string;
    storageKey: string;
    originalFilename: string;
    contentType: string;
    sizeBytes: number;
    createdBy: string;
  }): Promise<UploadRecord | null> {
    try {
      return await this.db.transaction(async (tx) => {
        await tx.execute(
          sql`select pg_advisory_xact_lock(hashtextextended(${input.chapterId}, 0))`,
        );
        const [active] = await tx
          .select({ id: uploads.id })
          .from(uploads)
          .where(
            and(
              eq(uploads.chapterId, input.chapterId),
              sql`${uploads.status} in ('pending', 'verifying', 'aborting')`,
            ),
          )
          .limit(1);
        if (active) throw uploadStateConflict;
        const [chapter] = await tx
          .update(chapters)
          .set({ status: "uploading", updatedAt: new Date() })
          .where(
            and(
              eq(chapters.id, input.chapterId),
              sql`${chapters.status} in ('draft', 'failed')`,
            ),
          )
          .returning({ id: chapters.id });
        if (!chapter) throw uploadStateConflict;
        const [row] = await tx.insert(uploads).values(input).returning();
        if (!row) throw new Error("upload-create-failed");
        return toRecord(row);
      });
    } catch (error) {
      if (error === uploadStateConflict || isUniqueViolation(error))
        return null;
      throw error;
    }
  }

  async finalizeIfAuthorized(
    input: Parameters<UploadLifecycleBoundaryPort["finalizeIfAuthorized"]>[0],
  ): ReturnType<UploadLifecycleBoundaryPort["finalizeIfAuthorized"]> {
    const snapshot = await this.loadChapterSnapshot(input.chapterId);
    if (!snapshot) return { outcome: "conflict" };
    try {
      return await this.db.transaction(async (tx) => {
        const context = await this.lockLifecycleContext({
          tx,
          actor: input.actor,
          chapterId: input.chapterId,
          uploadId: input.uploadId,
          expectedSeriesId: snapshot.seriesId,
        });
        if (context.outcome !== "authorized") return context;
        const { chapter, upload } = context;
        if (
          upload?.status !== "verifying" ||
          chapter.status !== "uploading" ||
          !verifiedMatchesUpload(input.verifiedObject, upload)
        )
          return { outcome: "conflict" as const };

        const [completed] = await tx
          .update(uploads)
          .set({
            status: "uploaded",
            sizeBytes: input.verifiedObject.sizeBytes,
            ...(input.verifiedObject.etag
              ? { etag: input.verifiedObject.etag }
              : {}),
            updatedAt: new Date(),
          })
          .where(
            and(
              eq(uploads.id, input.uploadId),
              eq(uploads.status, "verifying"),
            ),
          )
          .returning();
        if (!completed) throw uploadStateConflict;
        const [updatedChapter] = await tx
          .update(chapters)
          .set({ status: "uploaded", updatedAt: new Date() })
          .where(
            and(
              eq(chapters.id, input.chapterId),
              eq(chapters.status, "uploading"),
            ),
          )
          .returning({ seriesId: chapters.seriesId });
        if (!updatedChapter) throw uploadStateConflict;
        await tx
          .update(chapterImportItems)
          .set({
            status: "uploaded",
            errorCode: null,
            updatedAt: new Date(),
          })
          .where(eq(chapterImportItems.uploadId, completed.id));
        await tx.insert(processingOutbox).values({
          uploadId: completed.id,
          chapterId: completed.chapterId,
          seriesId: updatedChapter.seriesId,
          storageKey: completed.storageKey,
          ...(input.originRequestId
            ? { originRequestId: input.originRequestId }
            : {}),
        });
        return { outcome: "uploaded" as const, upload: toRecord(completed) };
      });
    } catch (error) {
      if (error === uploadStateConflict)
        return { outcome: "conflict" as const };
      throw error;
    }
  }

  async claimAbortIfAuthorized(
    input: Parameters<UploadLifecycleBoundaryPort["claimAbortIfAuthorized"]>[0],
  ): ReturnType<UploadLifecycleBoundaryPort["claimAbortIfAuthorized"]> {
    const snapshot = await this.loadChapterSnapshot(input.chapterId);
    if (!snapshot) return { outcome: "conflict" };
    return this.db.transaction(async (tx) => {
      const context = await this.lockLifecycleContext({
        tx,
        actor: input.actor,
        chapterId: input.chapterId,
        uploadId: input.uploadId,
        expectedSeriesId: snapshot.seriesId,
      });
      if (context.outcome !== "authorized") return context;
      const { upload } = context;
      if (upload?.status !== "pending") return { outcome: "conflict" as const };
      const [claimed] = await tx
        .update(uploads)
        .set({ status: "aborting", updatedAt: new Date() })
        .where(
          and(eq(uploads.id, input.uploadId), eq(uploads.status, "pending")),
        )
        .returning();
      return claimed
        ? { outcome: "claimed" as const, upload: toRecord(claimed) }
        : { outcome: "conflict" as const };
    });
  }

  async claimForCompletion(
    id: string,
    chapterId: string,
  ): Promise<UploadRecord | null> {
    const [row] = await this.db
      .update(uploads)
      .set({ status: "verifying", updatedAt: new Date() })
      .where(
        and(
          eq(uploads.id, id),
          eq(uploads.chapterId, chapterId),
          eq(uploads.status, "pending"),
        ),
      )
      .returning();
    return row ? toRecord(row) : null;
  }

  async releaseCompletion(id: string): Promise<void> {
    await this.db
      .update(uploads)
      .set({ status: "pending", updatedAt: new Date() })
      .where(and(eq(uploads.id, id), eq(uploads.status, "verifying")));
  }

  async claimForAbort(
    id: string,
    chapterId: string,
  ): Promise<UploadRecord | null> {
    const [row] = await this.db
      .update(uploads)
      .set({ status: "aborting", updatedAt: new Date() })
      .where(
        and(
          eq(uploads.id, id),
          eq(uploads.chapterId, chapterId),
          eq(uploads.status, "pending"),
        ),
      )
      .returning();
    return row ? toRecord(row) : null;
  }

  async releaseAbort(id: string): Promise<void> {
    await this.db
      .update(uploads)
      .set({ status: "pending", updatedAt: new Date() })
      .where(and(eq(uploads.id, id), eq(uploads.status, "aborting")));
  }

  async findActiveByChapterId(chapterId: string): Promise<UploadRecord | null> {
    const [row] = await this.db
      .select()
      .from(uploads)
      .where(
        and(
          eq(uploads.chapterId, chapterId),
          sql`${uploads.status} in ('pending', 'verifying', 'aborting')`,
        ),
      )
      .limit(1);
    return row ? toRecord(row) : null;
  }

  async findByIdAndChapterId(
    id: string,
    chapterId: string,
  ): Promise<UploadRecord | null> {
    const [row] = await this.db
      .select()
      .from(uploads)
      .where(and(eq(uploads.id, id), eq(uploads.chapterId, chapterId)))
      .limit(1);
    return row ? toRecord(row) : null;
  }

  async removePending(id: string): Promise<boolean> {
    return this.removeWithStatus(id, "pending");
  }

  async removeAborting(id: string): Promise<boolean> {
    return this.removeWithStatus(id, "aborting");
  }

  private async removeWithStatus(
    id: string,
    status: "pending" | "aborting",
  ): Promise<boolean> {
    try {
      return await this.db.transaction(async (tx) => {
        const [row] = await tx
          .select({ chapterId: uploads.chapterId })
          .from(uploads)
          .where(and(eq(uploads.id, id), eq(uploads.status, status)))
          .limit(1)
          .for("update");
        if (!row) return false;
        await tx
          .update(chapterImportItems)
          .set({
            uploadId: null,
            status: "failed",
            errorCode: "upload-aborted",
            updatedAt: new Date(),
          })
          .where(eq(chapterImportItems.uploadId, id));
        const [removed] = await tx
          .delete(uploads)
          .where(and(eq(uploads.id, id), eq(uploads.status, status)))
          .returning({ id: uploads.id });
        if (!removed) throw uploadStateConflict;
        const [chapter] = await tx
          .update(chapters)
          .set({ status: "draft", updatedAt: new Date() })
          .where(
            and(
              eq(chapters.id, row.chapterId),
              eq(chapters.status, "uploading"),
            ),
          )
          .returning({ id: chapters.id });
        if (!chapter) throw uploadStateConflict;
        return true;
      });
    } catch (error) {
      if (error === uploadStateConflict) return false;
      throw error;
    }
  }

  private async loadChapterSnapshot(chapterId: string) {
    const [chapter] = await this.db
      .select({ seriesId: chapters.seriesId })
      .from(chapters)
      .where(eq(chapters.id, chapterId))
      .limit(1);
    return chapter ?? null;
  }

  private async lockLifecycleContext(input: {
    tx: NodeProxTransaction;
    actor: Parameters<
      UploadLifecycleBoundaryPort["finalizeIfAuthorized"]
    >[0]["actor"];
    chapterId: string;
    uploadId: string;
    expectedSeriesId: string;
  }): Promise<
    | {
        outcome: "authorized";
        chapter: typeof chapters.$inferSelect;
        upload: typeof uploads.$inferSelect;
      }
    | { outcome: "denied" | "conflict" }
  > {
    const actor = await lockCurrentAuthorization({
      tx: input.tx,
      actor: input.actor,
      permission: PERMISSIONS.IMAGES_UPLOAD,
    });
    if (!actor.allowed) return { outcome: "denied" };

    let isSeriesOwner = false;
    let isAssigned = false;
    if (actor.role !== "admin") {
      const [lockedSeries] = await input.tx
        .select({ createdBy: series.createdBy })
        .from(series)
        .where(eq(series.id, input.expectedSeriesId))
        .limit(1)
        .for("update");
      if (!lockedSeries) return { outcome: "conflict" };
      isSeriesOwner = lockedSeries.createdBy === input.actor.userId;
      const [assignment] = await input.tx
        .select({ responsibleUserId: seriesAssignments.responsibleUserId })
        .from(seriesAssignments)
        .where(eq(seriesAssignments.seriesId, input.expectedSeriesId))
        .limit(1)
        .for("update");
      isAssigned = assignment?.responsibleUserId === input.actor.userId;
    }

    const [chapter] = await input.tx
      .select()
      .from(chapters)
      .where(eq(chapters.id, input.chapterId))
      .limit(1)
      .for("update");
    if (!chapter || chapter.seriesId !== input.expectedSeriesId)
      return { outcome: "conflict" };
    const [upload] = await input.tx
      .select()
      .from(uploads)
      .where(
        and(
          eq(uploads.id, input.uploadId),
          eq(uploads.chapterId, input.chapterId),
        ),
      )
      .limit(1)
      .for("update");
    if (!upload) return { outcome: "conflict" };

    let hasHelperPermission = false;
    if (actor.role !== "admin") {
      const [helperPermission] = await input.tx
        .select({ id: chapterPermissions.id })
        .from(chapterPermissions)
        .where(
          and(
            eq(chapterPermissions.chapterId, input.chapterId),
            eq(chapterPermissions.helperUserId, input.actor.userId),
            eq(chapterPermissions.permission, PERMISSIONS.IMAGES_UPLOAD),
            isNull(chapterPermissions.revokedAt),
          ),
        )
        .limit(1)
        .for("update");
      hasHelperPermission = Boolean(helperPermission);
    }
    const reason = evaluateChapterContextualAuthorization({
      role: actor.role,
      isSeriesOwner,
      isAssigned,
      hasHelperPermission,
    });
    return reason
      ? { outcome: "authorized", chapter, upload }
      : { outcome: "denied" };
  }

  async recoverStaleClaims(cutoff: Date): Promise<void> {
    await this.db
      .update(uploads)
      .set({ status: "pending", updatedAt: new Date() })
      .where(
        and(
          sql`${uploads.status} in ('verifying', 'aborting')`,
          lte(uploads.updatedAt, cutoff),
        ),
      );
  }

  async findStalePending(cutoff: Date, limit: number): Promise<UploadRecord[]> {
    const rows = await this.db
      .select()
      .from(uploads)
      .where(and(eq(uploads.status, "pending"), lte(uploads.updatedAt, cutoff)))
      .limit(limit);
    return rows.map(toRecord);
  }

  async findPending(limit: number) {
    const rows = await this.db
      .select({
        id: processingOutbox.id,
        chapterId: processingOutbox.chapterId,
        seriesId: processingOutbox.seriesId,
        uploadId: processingOutbox.uploadId,
        sourceStorageKey: processingOutbox.storageKey,
        originRequestId: processingOutbox.originRequestId,
      })
      .from(processingOutbox)
      .where(
        and(
          eq(processingOutbox.status, "pending"),
          lte(processingOutbox.availableAt, new Date()),
        ),
      )
      .limit(limit);
    return rows.map((row) => ({
      id: row.id,
      chapterId: row.chapterId,
      seriesId: row.seriesId,
      uploadId: row.uploadId,
      sourceStorageKey: row.sourceStorageKey,
      ...(row.originRequestId ? { originRequestId: row.originRequestId } : {}),
    }));
  }

  async markEnqueued(id: string): Promise<void> {
    await this.db
      .update(processingOutbox)
      .set({
        status: "enqueued",
        attempts: sql`${processingOutbox.attempts} + 1`,
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(processingOutbox.id, id),
          eq(processingOutbox.status, "pending"),
        ),
      );
  }

  async append(input: {
    actorId: string;
    action: string;
    resourceType: string;
    resourceId?: string;
    result?: "success" | "rejected" | "failed";
    reasonCode?: string;
    requestId?: string;
    metadata?: Record<string, unknown>;
  }): Promise<void> {
    await this.db.insert(auditLogs).values({
      actorId: input.actorId,
      action: input.action,
      resourceType: input.resourceType,
      ...(input.resourceId ? { resourceId: input.resourceId } : {}),
      ...(input.result ? { result: input.result } : {}),
      ...(input.reasonCode ? { reasonCode: input.reasonCode } : {}),
      ...(input.requestId ? { requestId: input.requestId } : {}),
      metadata: sanitizeAuditMetadata(input.metadata),
    });
  }
}

const uploadStateConflict = new Error("upload-state-conflict");

function isUniqueViolation(error: unknown): boolean {
  if (typeof error !== "object" || error === null) return false;
  if ("code" in error && error.code === "23505") return true;
  return "cause" in error && isUniqueViolation(error.cause);
}

function verifiedMatchesUpload(
  verified: Parameters<
    UploadLifecycleBoundaryPort["finalizeIfAuthorized"]
  >[0]["verifiedObject"],
  upload: typeof uploads.$inferSelect,
): boolean {
  return (
    verified.key === upload.storageKey &&
    verified.sizeBytes > 0 &&
    verified.sizeBytes === upload.sizeBytes &&
    (verified.contentType === undefined ||
      normalizeContentType(verified.contentType) ===
        normalizeContentType(upload.contentType))
  );
}

function normalizeContentType(value: string): string {
  return value.split(";", 1)[0]?.trim().toLowerCase() ?? "";
}
