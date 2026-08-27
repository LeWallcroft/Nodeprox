import { and, eq, lte, sql } from "drizzle-orm";
import type { NodeProxDatabase } from "../../../../../../../../database/client.js";
import {
  auditLogs,
  chapters,
  processingOutbox,
  uploads,
} from "../../../../../../../../database/schema/index.js";
import type { AuthorizationAuditRepository } from "../../../../authorization/application/ports/authorization.ports.js";
import type { ProcessingOutboxPort } from "../../../../processing/application/ports.js";
import { sanitizeAuditMetadata } from "../../../../authorization/infrastructure/audit/audit-metadata.js";
import type {
  UploadAuditPort,
  UploadRepositoryPort,
} from "../../../application/ports/upload.ports.js";
import type {
  StoredObject,
  UploadRecord,
} from "../../../domain/upload.types.js";

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
          .where(eq(uploads.chapterId, input.chapterId))
          .limit(1);
        if (active) throw uploadStateConflict;
        const [chapter] = await tx
          .update(chapters)
          .set({ status: "uploading", updatedAt: new Date() })
          .where(
            and(eq(chapters.id, input.chapterId), eq(chapters.status, "draft")),
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

  async markUploaded(
    id: string,
    stored: StoredObject,
  ): Promise<UploadRecord | null> {
    try {
      return await this.db.transaction(async (tx) => {
        const [row] = await tx
          .update(uploads)
          .set({
            status: "uploaded",
            sizeBytes: stored.sizeBytes,
            ...(stored.etag ? { etag: stored.etag } : {}),
            updatedAt: new Date(),
          })
          .where(and(eq(uploads.id, id), eq(uploads.status, "verifying")))
          .returning();
        if (!row) throw uploadStateConflict;
        const [chapter] = await tx
          .update(chapters)
          .set({ status: "uploaded", updatedAt: new Date() })
          .where(
            and(
              eq(chapters.id, row.chapterId),
              eq(chapters.status, "uploading"),
            ),
          )
          .returning({ seriesId: chapters.seriesId });
        if (!chapter) throw uploadStateConflict;
        await tx.insert(processingOutbox).values({
          uploadId: row.id,
          chapterId: row.chapterId,
          seriesId: chapter.seriesId,
          storageKey: row.storageKey,
        });
        return toRecord(row);
      });
    } catch (error) {
      if (error === uploadStateConflict) return null;
      throw error;
    }
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
      .where(eq(uploads.chapterId, chapterId))
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
          .delete(uploads)
          .where(and(eq(uploads.id, id), eq(uploads.status, status)))
          .returning({ chapterId: uploads.chapterId });
        if (!row) return false;
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
      })
      .from(processingOutbox)
      .where(
        and(
          eq(processingOutbox.status, "pending"),
          lte(processingOutbox.availableAt, new Date()),
        ),
      )
      .limit(limit);
    return rows;
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
    metadata?: Record<string, unknown>;
  }): Promise<void> {
    await this.db.insert(auditLogs).values({
      actorId: input.actorId,
      action: input.action,
      resourceType: input.resourceType,
      ...(input.resourceId ? { resourceId: input.resourceId } : {}),
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
