import { randomUUID } from "node:crypto";
import { sanitizeAuditMetadata } from "@nodeprox/types";
import { and, eq, inArray, sql } from "drizzle-orm";
import type { NodeProxDatabase } from "../../../../../../../database/client.js";
import { transitionChapterState } from "../../../../../../../database/chapter-state-transition.js";
import {
  auditLogs,
  chapterImportItems,
  chapterProcessingAttempts,
  chapterProcessingObjects,
  chapters,
  domainEventOutbox,
  images,
  imageVersions,
  series,
  uploads,
} from "../../../../../../../database/schema/index.js";
import type {
  ImageRecordInput,
  ProcessingAttempt,
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
        storageProfileId: uploads.storageProfileId,
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
  async claimChapter(
    input: Parameters<ProcessingRepositoryPort["claimChapter"]>[0],
  ): ReturnType<ProcessingRepositoryPort["claimChapter"]> {
    return this.db.transaction(async (tx) => {
      const [chapter] = await tx
        .select({ status: chapters.status })
        .from(chapters)
        .where(eq(chapters.id, input.chapterId))
        .limit(1)
        .for("update");
      if (!chapter) return { outcome: "not-found" as const };
      const [upload] = await tx
        .select({ storageProfileId: uploads.storageProfileId })
        .from(uploads)
        .where(eq(uploads.id, input.uploadId))
        .limit(1);
      if (!upload) return { outcome: "not-found" as const };

      if (input.jobId !== undefined && input.jobAttempt !== undefined) {
        const [existing] = await tx
          .select()
          .from(chapterProcessingAttempts)
          .where(
            and(
              eq(chapterProcessingAttempts.jobId, input.jobId),
              eq(chapterProcessingAttempts.jobAttempt, input.jobAttempt),
            ),
          )
          .limit(1);
        if (existing)
          return existing.status === "processing"
            ? { outcome: "resumed" as const, attempt: toAttempt(existing) }
            : { outcome: "finished" as const, attempt: toAttempt(existing) };
      }

      const transition =
        chapter.status === "failed" ? "retry-processing" : "start-processing";
      const stateResult = await transitionChapterState(tx, {
        chapterId: input.chapterId,
        transition,
        expectedStates: [chapter.status],
      });
      if (!stateResult.transitioned)
        return {
          outcome: stateResult.reason,
          ...(stateResult.currentState
            ? { currentState: stateResult.currentState }
            : {}),
        };

      const [attemptNumberRow] = await tx
        .select({
          nextAttemptNumber:
            sql<number>`coalesce(max(${chapterProcessingAttempts.attemptNumber}), 0) + 1`.mapWith(
              Number,
            ),
        })
        .from(chapterProcessingAttempts)
        .where(eq(chapterProcessingAttempts.chapterId, input.chapterId));
      if (!attemptNumberRow) throw new Error("chapter-attempt-number-failed");
      const { nextAttemptNumber } = attemptNumberRow;

      const [attempt] = await tx
        .insert(chapterProcessingAttempts)
        .values({
          chapterId: input.chapterId,
          uploadId: input.uploadId,
          storageProfileId: upload.storageProfileId,
          ...(input.jobId !== undefined ? { jobId: input.jobId } : {}),
          ...(input.jobAttempt !== undefined
            ? { jobAttempt: input.jobAttempt }
            : {}),
          attemptNumber: nextAttemptNumber,
        })
        .returning();
      if (!attempt) throw new Error("chapter-attempt-create-failed");
      await tx
        .update(chapterImportItems)
        .set({ status: "processing", errorCode: null, updatedAt: new Date() })
        .where(eq(chapterImportItems.uploadId, input.uploadId));
      return { outcome: "claimed" as const, attempt: toAttempt(attempt) };
    });
  }
  async reserveCandidate(
    attemptId: string,
    storageKey: string,
    checksum: string,
  ): Promise<void> {
    const [attempt] = await this.db
      .select({ storageProfileId: chapterProcessingAttempts.storageProfileId })
      .from(chapterProcessingAttempts)
      .where(eq(chapterProcessingAttempts.id, attemptId))
      .limit(1);
    if (!attempt) throw new Error("chapter-attempt-not-found");
    await this.db
      .insert(chapterProcessingObjects)
      .values({
        attemptId,
        storageProfileId: attempt.storageProfileId,
        storageKey,
        checksum,
      })
      .onConflictDoNothing();
    const [candidate] = await this.db
      .select({ checksum: chapterProcessingObjects.checksum })
      .from(chapterProcessingObjects)
      .where(
        and(
          eq(chapterProcessingObjects.attemptId, attemptId),
          eq(chapterProcessingObjects.storageKey, storageKey),
        ),
      )
      .limit(1);
    if (!candidate || candidate.checksum !== checksum)
      throw new Error("storage-key-content-conflict");
  }
  async markCandidate(
    attemptId: string,
    storageKey: string,
    status: "created" | "reused" | "cleaned",
  ): Promise<void> {
    const [updated] = await this.db
      .update(chapterProcessingObjects)
      .set({ status, updatedAt: new Date() })
      .where(
        and(
          eq(chapterProcessingObjects.attemptId, attemptId),
          eq(chapterProcessingObjects.storageKey, storageKey),
        ),
      )
      .returning({ id: chapterProcessingObjects.id });
    if (!updated) throw new Error("chapter-candidate-not-reserved");
  }
  async replaceImagesAndMarkReady(
    chapterId: string,
    uploadId: string,
    attemptId: string,
    requestedByUserId: string,
    records: ImageRecordInput[],
  ): Promise<void> {
    await this.db.transaction(async (tx) => {
      const [attempt] = await tx
        .select()
        .from(chapterProcessingAttempts)
        .where(eq(chapterProcessingAttempts.id, attemptId))
        .limit(1)
        .for("update");
      if (!attempt || attempt.chapterId !== chapterId)
        throw new Error("chapter-attempt-transition-conflict");
      if (attempt.status === "succeeded") return;
      if (attempt.status !== "processing")
        throw new Error("chapter-attempt-transition-conflict");
      const [currentChapter] = await tx
        .select({ status: chapters.status })
        .from(chapters)
        .where(eq(chapters.id, chapterId))
        .limit(1)
        .for("update");
      if (!currentChapter) throw new Error("chapter-ready-transition-conflict");
      const stateResult = await transitionChapterState(tx, {
        chapterId,
        transition: "processing-succeeded",
        expectedStates: [currentChapter.status],
      });
      if (!stateResult.transitioned)
        throw new Error("chapter-ready-transition-conflict");
      const candidates = await tx
        .select({
          storageKey: chapterProcessingObjects.storageKey,
          storageProfileId: chapterProcessingObjects.storageProfileId,
          status: chapterProcessingObjects.status,
        })
        .from(chapterProcessingObjects)
        .where(eq(chapterProcessingObjects.attemptId, attemptId));
      if (
        candidates.length !== records.length ||
        candidates.some(
          (candidate) =>
            !records.some(
              (record) =>
                record.storageKey === candidate.storageKey &&
                record.storageProfileId === candidate.storageProfileId,
            ) || !["created", "reused"].includes(candidate.status),
        )
      )
        throw new Error("chapter-candidate-publication-conflict");
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
          storageProfileId: record.storageProfileId,
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
          storageProfileId: record.storageProfileId,
          extension: record.extension,
          contentType: record.contentType,
          sizeBytes: record.sizeBytes,
          checksum: record.checksum,
        })),
      );
      const [finishedAttempt] = await tx
        .update(chapterProcessingAttempts)
        .set({ status: "succeeded", finishedAt: new Date() })
        .where(
          and(
            eq(chapterProcessingAttempts.id, attemptId),
            eq(chapterProcessingAttempts.status, "processing"),
          ),
        )
        .returning({ id: chapterProcessingAttempts.id });
      if (!finishedAttempt)
        throw new Error("chapter-attempt-transition-conflict");
      await tx
        .update(chapterProcessingObjects)
        .set({ status: "published", updatedAt: new Date() })
        .where(
          and(
            eq(chapterProcessingObjects.attemptId, attemptId),
            inArray(chapterProcessingObjects.status, ["created", "reused"]),
          ),
        );
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
  async markFailed(
    chapterId: string,
    uploadId: string,
    attemptId: string,
    failure: { terminal: boolean; errorCode: string; errorMessage: string },
    requestedByUserId: string,
  ): Promise<void> {
    await this.db.transaction(async (tx) => {
      const [attempt] = await tx
        .select()
        .from(chapterProcessingAttempts)
        .where(eq(chapterProcessingAttempts.id, attemptId))
        .limit(1)
        .for("update");
      if (!attempt || attempt.chapterId !== chapterId)
        throw new Error("chapter-attempt-transition-conflict");
      if (attempt.status !== "processing") return;
      const [chapter] = await tx
        .select({ status: chapters.status })
        .from(chapters)
        .where(eq(chapters.id, chapterId))
        .limit(1)
        .for("update");
      if (!chapter) throw new Error("chapter-attempt-transition-conflict");
      const transition = failure.terminal
        ? "processing-failed"
        : "processing-retry";
      const stateResult = await transitionChapterState(tx, {
        chapterId,
        transition,
        expectedStates: [chapter.status],
      });
      if (!stateResult.transitioned)
        throw new Error("chapter-attempt-transition-conflict");
      await tx
        .update(chapterProcessingAttempts)
        .set({
          status: failure.terminal ? "terminal_failed" : "retryable_failed",
          errorCode: failure.errorCode,
          errorMessage: failure.errorMessage,
          finishedAt: new Date(),
        })
        .where(
          and(
            eq(chapterProcessingAttempts.id, attemptId),
            eq(chapterProcessingAttempts.status, "processing"),
          ),
        );
      await tx
        .update(chapterImportItems)
        .set({
          status: failure.terminal ? "failed" : "uploaded",
          errorCode: failure.terminal ? failure.errorCode : null,
          updatedAt: new Date(),
        })
        .where(eq(chapterImportItems.uploadId, uploadId));
      await tx
        .update(chapterProcessingObjects)
        .set({ status: "cleanup_pending", updatedAt: new Date() })
        .where(
          and(
            eq(chapterProcessingObjects.attemptId, attemptId),
            eq(chapterProcessingObjects.status, "created"),
          ),
        );
      if (failure.terminal)
        await tx.insert(domainEventOutbox).values({
          eventType: "upload.failed",
          aggregateType: "chapter_upload",
          aggregateId: uploadId,
          actorUserId: requestedByUserId,
          payload: {
            targetUserId: requestedByUserId,
            chapterId,
            operationKind: "chapter_import",
            errorCode: failure.errorCode,
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

function toAttempt(
  row: typeof chapterProcessingAttempts.$inferSelect,
): ProcessingAttempt {
  return {
    id: row.id,
    chapterId: row.chapterId,
    uploadId: row.uploadId,
    storageProfileId: row.storageProfileId,
    jobId: row.jobId,
    jobAttempt: row.jobAttempt,
    attemptNumber: row.attemptNumber,
    status: row.status,
    errorCode: row.errorCode,
    errorMessage: row.errorMessage,
    startedAt: row.startedAt,
    finishedAt: row.finishedAt,
  };
}
