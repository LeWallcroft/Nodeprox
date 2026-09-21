import { randomUUID } from "node:crypto";
import { sanitizeAuditMetadata } from "@nodeprox/types";
import { and, eq, sql } from "drizzle-orm";
import type { NodeProxDatabase } from "../../../../../../../database/client.js";
import {
  auditLogs,
  chapterImportItems,
  chapters,
  domainEventOutbox,
  images,
  imageVersions,
  series,
  uploads,
} from "../../../../../../../database/schema/index.js";
import type {
  ImageRecordInput,
  ProcessingAuditPort,
  ProcessingRepositoryPort,
} from "../../../application/ports.js";
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
        seriesPublicSlug: series.slug,
        chapterPublicKey: chapters.publicKey,
        createdBy: uploads.createdBy,
        storageKey: uploads.storageKey,
        status: uploads.status,
        chapterStatus: chapters.status,
      })
      .from(uploads)
      .innerJoin(chapters, eq(chapters.id, uploads.chapterId))
      .innerJoin(series, eq(series.id, chapters.seriesId))
      .where(eq(uploads.id, uploadId))
      .limit(1);
    return row ?? null;
  }
  async claimChapter(chapterId: string, uploadId: string): Promise<boolean> {
    return this.db.transaction(async (tx) => {
      const [row] = await tx
        .update(chapters)
        .set({ status: "processing", updatedAt: new Date() })
        .where(
          and(
            eq(chapters.id, chapterId),
            sql`${chapters.status} in ('uploaded', 'failed')`,
          ),
        )
        .returning({ id: chapters.id });
      if (!row) return false;
      await tx
        .update(chapterImportItems)
        .set({ status: "processing", errorCode: null, updatedAt: new Date() })
        .where(eq(chapterImportItems.uploadId, uploadId));
      return true;
    });
  }
  async replaceImagesAndMarkReady(
    chapterId: string,
    uploadId: string,
    requestedByUserId: string,
    records: ImageRecordInput[],
  ): Promise<void> {
    await this.db.transaction(async (tx) => {
      await tx.delete(images).where(eq(images.chapterId, chapterId));
      const prepared = records.map((record) => ({
        imageId: randomUUID(),
        versionId: randomUUID(),
        record,
      }));
      await tx.insert(images).values(
        prepared.map(({ imageId, versionId, record }) => ({
          id: imageId,
          chapterId,
          filename: record.filename,
          storageKey: record.storageKey,
          extension: record.extension,
          contentType: record.contentType,
          sizeBytes: record.sizeBytes,
          sortOrder: record.sortOrder,
          checksum: record.checksum,
          warnings: record.warnings,
          currentVersionId: versionId,
        })),
      );
      await tx.insert(imageVersions).values(
        prepared.map(({ imageId, versionId, record }) => ({
          id: versionId,
          imageId,
          version: 1,
          physicalFilename: record.filename,
          storageKey: record.storageKey,
          extension: record.extension,
          contentType: record.contentType,
          sizeBytes: record.sizeBytes,
          checksum: record.checksum,
        })),
      );
      const [chapter] = await tx
        .update(chapters)
        .set({ status: "ready", updatedAt: new Date() })
        .where(
          and(eq(chapters.id, chapterId), eq(chapters.status, "processing")),
        )
        .returning({ id: chapters.id });
      if (!chapter) throw new Error("chapter-ready-transition-conflict");
      await tx
        .update(chapterImportItems)
        .set({ status: "ready", errorCode: null, updatedAt: new Date() })
        .where(eq(chapterImportItems.uploadId, uploadId));
      await tx.insert(domainEventOutbox).values({
        eventType: "upload.completed",
        aggregateType: "chapter_upload",
        aggregateId: uploadId,
        actorUserId: requestedByUserId,
        payload: {
          targetUserId: requestedByUserId,
          chapterId,
          operationKind: "chapter_import",
        },
      });
    });
  }
  async deleteImages(chapterId: string): Promise<void> {
    await this.db.delete(images).where(eq(images.chapterId, chapterId));
  }
  async markFailed(
    chapterId: string,
    uploadId: string,
    terminal: boolean,
    requestedByUserId: string,
  ): Promise<void> {
    await this.db.transaction(async (tx) => {
      await tx
        .update(chapters)
        .set({
          // A retryable BullMQ failure has not reached the terminal Chapter
          // lifecycle: the uploaded ZIP remains queued for the next attempt.
          status: terminal ? "failed" : "uploaded",
          updatedAt: new Date(),
        })
        .where(eq(chapters.id, chapterId));
      await tx
        .update(chapterImportItems)
        .set({
          status: terminal ? "failed" : "uploaded",
          errorCode: terminal ? "processing-failed" : null,
          updatedAt: new Date(),
        })
        .where(eq(chapterImportItems.uploadId, uploadId));
      if (terminal)
        await tx.insert(domainEventOutbox).values({
          eventType: "upload.failed",
          aggregateType: "chapter_upload",
          aggregateId: uploadId,
          actorUserId: requestedByUserId,
          payload: {
            targetUserId: requestedByUserId,
            chapterId,
            operationKind: "chapter_import",
            errorCode: "processing-failed",
          },
        });
    });
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
