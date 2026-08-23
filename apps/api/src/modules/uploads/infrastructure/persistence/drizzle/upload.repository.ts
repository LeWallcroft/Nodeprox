import { and, eq } from "drizzle-orm";
import type { NodeProxDatabase } from "../../../../../../../../database/client.js";
import {
  auditLogs,
  chapters,
  uploads,
} from "../../../../../../../../database/schema/index.js";
import type { AuthorizationAuditRepository } from "../../../../authorization/application/ports/authorization.ports.js";
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
  implements UploadRepositoryPort, UploadAuditPort, AuthorizationAuditRepository
{
  constructor(private readonly db: NodeProxDatabase) {}

  async createPending(input: {
    id: string;
    chapterId: string;
    storageKey: string;
    originalFilename: string;
    contentType: string;
    createdBy: string;
  }): Promise<UploadRecord> {
    return this.db.transaction(async (tx) => {
      const [row] = await tx
        .insert(uploads)
        .values({ ...input, sizeBytes: 0 })
        .returning();
      if (!row) throw new Error("upload-create-failed");
      await tx
        .update(chapters)
        .set({ status: "uploading", updatedAt: new Date() })
        .where(eq(chapters.id, input.chapterId));
      return toRecord(row);
    });
  }

  async markUploaded(id: string, stored: StoredObject): Promise<UploadRecord> {
    return this.db.transaction(async (tx) => {
      const [row] = await tx
        .update(uploads)
        .set({
          status: "uploaded",
          sizeBytes: stored.sizeBytes,
          ...(stored.etag ? { etag: stored.etag } : {}),
          updatedAt: new Date(),
        })
        .where(and(eq(uploads.id, id), eq(uploads.status, "pending")))
        .returning();
      if (!row) throw new Error("upload-finalize-failed");
      await tx
        .update(chapters)
        .set({ status: "uploaded", updatedAt: new Date() })
        .where(eq(chapters.id, row.chapterId));
      return toRecord(row);
    });
  }

  async findActiveByChapterId(chapterId: string): Promise<UploadRecord | null> {
    const [row] = await this.db
      .select()
      .from(uploads)
      .where(eq(uploads.chapterId, chapterId))
      .limit(1);
    return row ? toRecord(row) : null;
  }

  async removePending(id: string): Promise<void> {
    await this.db.transaction(async (tx) => {
      const [row] = await tx
        .delete(uploads)
        .where(and(eq(uploads.id, id), eq(uploads.status, "pending")))
        .returning({ chapterId: uploads.chapterId });
      if (row)
        await tx
          .update(chapters)
          .set({ status: "draft", updatedAt: new Date() })
          .where(eq(chapters.id, row.chapterId));
    });
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
