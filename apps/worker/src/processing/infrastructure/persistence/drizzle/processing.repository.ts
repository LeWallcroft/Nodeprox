import { and, eq, sql } from "drizzle-orm";
import type { NodeProxDatabase } from "../../../../../../../database/client.js";
import {
  auditLogs,
  chapters,
  images,
  uploads,
} from "../../../../../../../database/schema/index.js";
import type {
  ImageRecordInput,
  ProcessingAuditPort,
  ProcessingRepositoryPort,
} from "../../../application/ports.js";
import { sanitizeAuditMetadata } from "@nodeprox/types";
export class DrizzleProcessingRepository
  implements ProcessingRepositoryPort, ProcessingAuditPort
{
  constructor(private readonly db: NodeProxDatabase) {}
  async findUpload(uploadId: string) {
    const [row] = await this.db
      .select({
        uploadId: uploads.id,
        chapterId: uploads.chapterId,
        seriesId: chapters.seriesId,
        createdBy: uploads.createdBy,
        storageKey: uploads.storageKey,
        status: uploads.status,
      })
      .from(uploads)
      .innerJoin(chapters, eq(chapters.id, uploads.chapterId))
      .where(eq(uploads.id, uploadId))
      .limit(1);
    return row ?? null;
  }
  async claimChapter(chapterId: string): Promise<boolean> {
    const [row] = await this.db
      .update(chapters)
      .set({ status: "processing", updatedAt: new Date() })
      .where(
        and(
          eq(chapters.id, chapterId),
          sql`${chapters.status} in ('uploaded', 'failed')`,
        ),
      )
      .returning({ id: chapters.id });
    return Boolean(row);
  }
  async replaceImagesAndMarkReady(
    chapterId: string,
    records: ImageRecordInput[],
  ): Promise<void> {
    await this.db.transaction(async (tx) => {
      await tx.delete(images).where(eq(images.chapterId, chapterId));
      await tx.insert(images).values(
        records.map((record) => ({
          chapterId,
          filename: record.filename,
          storageKey: record.storageKey,
          extension: record.extension,
          contentType: record.contentType,
          sizeBytes: record.sizeBytes,
          sortOrder: record.sortOrder,
          checksum: record.checksum,
        })),
      );
      await tx
        .update(chapters)
        .set({ status: "ready", updatedAt: new Date() })
        .where(
          and(eq(chapters.id, chapterId), eq(chapters.status, "processing")),
        );
    });
  }
  async deleteImages(chapterId: string): Promise<void> {
    await this.db.delete(images).where(eq(images.chapterId, chapterId));
  }
  async markFailed(chapterId: string): Promise<void> {
    await this.db
      .update(chapters)
      .set({ status: "failed", updatedAt: new Date() })
      .where(eq(chapters.id, chapterId));
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
