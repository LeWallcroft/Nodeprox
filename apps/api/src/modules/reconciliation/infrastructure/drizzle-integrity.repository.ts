import { and, asc, eq, gt, isNull, ne } from "drizzle-orm";
import type { NodeProxDatabase } from "../../../../../../database/client.js";
import { transitionChapterState } from "../../../../../../database/chapter-state-transition.js";
import {
  chapterImportItems,
  chapterDeletionOutbox,
  chapterProcessingAttempts,
  chapterProcessingObjects,
  chapterReplacementOperations,
  chapterReplacementProcessingOutbox,
  chapters,
  images,
  imageVersions,
  processingOutbox,
  series,
  storageCleanupOutbox,
  uploads,
} from "../../../../../../database/schema/index.js";
import { buildChapterMediaStorageKey } from "@nodeprox/storage";
import {
  processingJobId,
  replacementProcessingJobId,
} from "../../processing/infrastructure/queue/bullmq.processing.queue.js";
import type {
  AttemptWork,
  CandidateObject,
  IntegrityRepositoryPort,
  QueueIntent,
  ReconciliationBatch,
  ReconciliationCursor,
} from "../application/integrity-reconciliation.service.js";

export class DrizzleIntegrityRepository implements IntegrityRepositoryPort {
  constructor(private readonly db: NodeProxDatabase) {}

  async scan(
    limit: number,
    cursor: ReconciliationCursor,
  ): Promise<ReconciliationBatch> {
    const processing = await this.db
      .select({ intent: processingOutbox, chapterStatus: chapters.status })
      .from(processingOutbox)
      .leftJoin(chapters, eq(chapters.id, processingOutbox.chapterId))
      .where(
        cursor.processingIntents
          ? gt(processingOutbox.id, cursor.processingIntents)
          : undefined,
      )
      .orderBy(asc(processingOutbox.id))
      .limit(limit);
    const deletions = await this.db
      .select({ intent: chapterDeletionOutbox, chapterStatus: chapters.status })
      .from(chapterDeletionOutbox)
      .leftJoin(chapters, eq(chapters.id, chapterDeletionOutbox.chapterId))
      .where(
        and(
          ne(chapterDeletionOutbox.status, "completed"),
          cursor.deletionIntents
            ? gt(chapterDeletionOutbox.id, cursor.deletionIntents)
            : undefined,
        ),
      )
      .orderBy(asc(chapterDeletionOutbox.id))
      .limit(limit);
    const replacements = await this.db
      .select({
        intent: chapterReplacementProcessingOutbox,
        operationStatus: chapterReplacementOperations.status,
      })
      .from(chapterReplacementProcessingOutbox)
      .innerJoin(
        chapterReplacementOperations,
        eq(
          chapterReplacementOperations.id,
          chapterReplacementProcessingOutbox.replacementId,
        ),
      )
      .where(
        cursor.replacementIntents
          ? gt(chapterReplacementProcessingOutbox.id, cursor.replacementIntents)
          : undefined,
      )
      .orderBy(asc(chapterReplacementProcessingOutbox.id))
      .limit(limit);
    const intents: QueueIntent[] = [
      ...processing.map(({ intent, chapterStatus }) => ({
        kind: "processing" as const,
        id: intent.id,
        chapterId: intent.chapterId,
        status: intent.status,
        aggregateStatus: chapterStatus,
        updatedAt: intent.updatedAt,
        jobId: processingJobId(intent),
        ...(intent.originRequestId
          ? { originRequestId: intent.originRequestId }
          : {}),
        payload: {
          chapterId: intent.chapterId,
          seriesId: intent.seriesId,
          uploadId: intent.uploadId,
          sourceStorageKey: intent.storageKey,
          ...(intent.originRequestId
            ? { originRequestId: intent.originRequestId }
            : {}),
        },
      })),
      ...deletions.map(({ intent, chapterStatus }) => ({
        kind: "deletion" as const,
        id: intent.id,
        chapterId: intent.chapterId,
        status: intent.status as "pending" | "enqueued",
        aggregateStatus: chapterStatus,
        updatedAt: intent.updatedAt,
        jobId: `chapter-deletion-${intent.id}`,
        ...(intent.originRequestId
          ? { originRequestId: intent.originRequestId }
          : {}),
        payload: {
          deletionId: intent.id,
          chapterId: intent.chapterId,
          ...(intent.originRequestId
            ? { originRequestId: intent.originRequestId }
            : {}),
        },
      })),
      ...replacements.map(({ intent, operationStatus }) => ({
        kind: "replacement" as const,
        id: intent.id,
        chapterId: intent.chapterId,
        status: intent.status,
        aggregateStatus: operationStatus,
        updatedAt: intent.updatedAt,
        jobId: replacementProcessingJobId(intent),
        ...(intent.originRequestId
          ? { originRequestId: intent.originRequestId }
          : {}),
        payload: {
          replacementId: intent.replacementId,
          chapterId: intent.chapterId,
          ...(intent.originRequestId
            ? { originRequestId: intent.originRequestId }
            : {}),
        },
      })),
    ];
    const readyRows = await this.db
      .select({
        id: imageVersions.id,
        chapterId: chapters.id,
        storageKey: imageVersions.storageKey,
        physicalFilename: imageVersions.physicalFilename,
        seriesSlug: series.slug,
        chapterPublicKey: chapters.publicKey,
      })
      .from(images)
      .innerJoin(chapters, eq(chapters.id, images.chapterId))
      .innerJoin(series, eq(series.id, chapters.seriesId))
      .innerJoin(imageVersions, eq(imageVersions.id, images.currentVersionId))
      .where(
        and(
          eq(chapters.status, "ready"),
          isNull(images.retiredAt),
          cursor.ready ? gt(imageVersions.id, cursor.ready) : undefined,
        ),
      )
      .orderBy(asc(imageVersions.id))
      .limit(limit);
    const ready = readyRows.map((row) => ({
      id: row.id,
      chapterId: row.chapterId,
      storageKey: row.storageKey,
      canonicalStorageKey: (() => {
        try {
          return buildChapterMediaStorageKey({
            seriesSlug: row.seriesSlug,
            chapterPublicKey: row.chapterPublicKey,
            physicalFilename: row.physicalFilename,
          });
        } catch {
          return "invalid-canonical-storage-key";
        }
      })(),
    }));
    const candidateRows = await this.db
      .select({
        object: chapterProcessingObjects,
        chapterId: chapterProcessingAttempts.chapterId,
        uploadId: chapterProcessingAttempts.uploadId,
        attemptStatus: chapterProcessingAttempts.status,
        originRequestId: processingOutbox.originRequestId,
      })
      .from(chapterProcessingObjects)
      .innerJoin(
        chapterProcessingAttempts,
        eq(chapterProcessingAttempts.id, chapterProcessingObjects.attemptId),
      )
      .leftJoin(
        processingOutbox,
        eq(processingOutbox.uploadId, chapterProcessingAttempts.uploadId),
      )
      .where(
        cursor.candidates
          ? gt(chapterProcessingObjects.id, cursor.candidates)
          : undefined,
      )
      .orderBy(asc(chapterProcessingObjects.id))
      .limit(limit);
    const candidates = candidateRows.map(
      ({ object, chapterId, uploadId, attemptStatus, originRequestId }) => ({
        id: object.id,
        chapterId,
        uploadId,
        attemptId: object.attemptId,
        storageKey: object.storageKey,
        checksum: object.checksum,
        status: object.status,
        attemptStatus,
        ...(originRequestId ? { originRequestId } : {}),
        createdAt: object.createdAt,
      }),
    );
    const attemptRows = await this.db
      .select({
        attempt: chapterProcessingAttempts,
        chapterStatus: chapters.status,
        sourceStorageKey: uploads.storageKey,
        originRequestId: processingOutbox.originRequestId,
      })
      .from(chapterProcessingAttempts)
      .leftJoin(chapters, eq(chapters.id, chapterProcessingAttempts.chapterId))
      .leftJoin(uploads, eq(uploads.id, chapterProcessingAttempts.uploadId))
      .leftJoin(
        processingOutbox,
        eq(processingOutbox.uploadId, chapterProcessingAttempts.uploadId),
      )
      .where(
        and(
          eq(chapterProcessingAttempts.status, "processing"),
          cursor.attempts
            ? gt(chapterProcessingAttempts.id, cursor.attempts)
            : undefined,
        ),
      )
      .orderBy(asc(chapterProcessingAttempts.id))
      .limit(limit);
    const attempts: AttemptWork[] = attemptRows.map(
      ({ attempt, chapterStatus, sourceStorageKey, originRequestId }) => ({
        id: attempt.id,
        chapterId: attempt.chapterId,
        uploadId: attempt.uploadId,
        jobId: attempt.jobId,
        jobAttempt: attempt.jobAttempt,
        chapterStatus,
        sourceStorageKey,
        status: attempt.status,
        startedAt: attempt.startedAt,
        ...(originRequestId ? { originRequestId } : {}),
      }),
    );
    const sourceRows = await this.db
      .select({
        id: chapterProcessingAttempts.id,
        chapterId: chapterProcessingAttempts.chapterId,
        uploadId: uploads.id,
        storageKey: uploads.storageKey,
        originRequestId: processingOutbox.originRequestId,
      })
      .from(chapterProcessingAttempts)
      .innerJoin(uploads, eq(uploads.id, chapterProcessingAttempts.uploadId))
      .leftJoin(processingOutbox, eq(processingOutbox.uploadId, uploads.id))
      .where(
        and(
          eq(chapterProcessingAttempts.status, "succeeded"),
          cursor.sources
            ? gt(chapterProcessingAttempts.id, cursor.sources)
            : undefined,
        ),
      )
      .orderBy(asc(chapterProcessingAttempts.id))
      .limit(limit);
    const cleanupRows = await this.db
      .select({
        intent: storageCleanupOutbox,
        chapterId: chapterReplacementOperations.chapterId,
      })
      .from(storageCleanupOutbox)
      .innerJoin(
        chapterReplacementOperations,
        eq(chapterReplacementOperations.id, storageCleanupOutbox.replacementId),
      )
      .where(
        and(
          ne(storageCleanupOutbox.status, "completed"),
          cursor.cleanupIntents
            ? gt(storageCleanupOutbox.id, cursor.cleanupIntents)
            : undefined,
        ),
      )
      .orderBy(asc(storageCleanupOutbox.id))
      .limit(limit);
    const nextCursor: ReconciliationCursor = { ...cursor };
    const advance = (key: keyof ReconciliationCursor, value?: string) => {
      if (value) nextCursor[key] = value;
    };
    advance("processingIntents", processing.at(-1)?.intent.id);
    advance("deletionIntents", deletions.at(-1)?.intent.id);
    advance("replacementIntents", replacements.at(-1)?.intent.id);
    advance("ready", ready.at(-1)?.id);
    advance("candidates", candidates.at(-1)?.id);
    advance("attempts", attempts.at(-1)?.id);
    advance("sources", sourceRows.at(-1)?.id);
    advance("cleanupIntents", cleanupRows.at(-1)?.intent.id);
    return {
      intents,
      ready,
      candidates,
      attempts,
      sources: sourceRows.map(({ originRequestId, ...source }) => ({
        ...source,
        ...(originRequestId ? { originRequestId } : {}),
      })),
      cleanupIntents: cleanupRows.map(({ intent, chapterId }) => ({
        id: intent.id,
        chapterId,
        storageKey: intent.storageKey,
        ...(intent.originRequestId
          ? { originRequestId: intent.originRequestId }
          : {}),
        status: intent.status as "pending" | "processing" | "failed",
        updatedAt: intent.updatedAt,
      })),
      nextCursor,
    };
  }

  async markEnqueued(intent: QueueIntent): Promise<void> {
    const updatedAt = new Date();
    if (intent.kind === "processing")
      await this.db
        .update(processingOutbox)
        .set({ status: "enqueued", updatedAt })
        .where(eq(processingOutbox.id, intent.id));
    else if (intent.kind === "deletion")
      await this.db
        .update(chapterDeletionOutbox)
        .set({ status: "enqueued", updatedAt })
        .where(eq(chapterDeletionOutbox.id, intent.id));
    else
      await this.db
        .update(chapterReplacementProcessingOutbox)
        .set({ status: "enqueued", enqueuedAt: updatedAt, updatedAt })
        .where(eq(chapterReplacementProcessingOutbox.id, intent.id));
  }
  async isPublishedKey(key: string): Promise<boolean> {
    const [row] = await this.db
      .select({ id: imageVersions.id })
      .from(imageVersions)
      .where(eq(imageVersions.storageKey, key))
      .limit(1);
    return Boolean(row);
  }
  async findProcessingIntent(uploadId: string): Promise<QueueIntent | null> {
    const [row] = await this.db
      .select({ intent: processingOutbox, chapterStatus: chapters.status })
      .from(processingOutbox)
      .leftJoin(chapters, eq(chapters.id, processingOutbox.chapterId))
      .where(eq(processingOutbox.uploadId, uploadId))
      .limit(1);
    if (!row) return null;
    return {
      kind: "processing",
      id: row.intent.id,
      chapterId: row.intent.chapterId,
      status: row.intent.status,
      jobId: processingJobId(row.intent),
      aggregateStatus: row.chapterStatus,
      updatedAt: row.intent.updatedAt,
      ...(row.intent.originRequestId
        ? { originRequestId: row.intent.originRequestId }
        : {}),
      payload: {
        chapterId: row.intent.chapterId,
        uploadId,
        seriesId: row.intent.seriesId,
        sourceStorageKey: row.intent.storageKey,
        ...(row.intent.originRequestId
          ? { originRequestId: row.intent.originRequestId }
          : {}),
      },
    };
  }
  async withCandidateCleanupLock(
    candidate: CandidateObject,
    cleanup: () => Promise<void>,
  ): Promise<boolean> {
    return this.db.transaction(async (tx) => {
      const [chapter] = await tx
        .select({ status: chapters.status })
        .from(chapters)
        .where(eq(chapters.id, candidate.chapterId))
        .limit(1)
        .for("update");
      if (
        !chapter ||
        chapter.status === "processing" ||
        chapter.status === "deleting"
      )
        return false;
      const [object] = await tx
        .select({
          id: chapterProcessingObjects.id,
          chapterId: chapterProcessingAttempts.chapterId,
          storageKey: chapterProcessingObjects.storageKey,
          checksum: chapterProcessingObjects.checksum,
          status: chapterProcessingObjects.status,
          attemptStatus: chapterProcessingAttempts.status,
        })
        .from(chapterProcessingObjects)
        .innerJoin(
          chapterProcessingAttempts,
          eq(chapterProcessingAttempts.id, chapterProcessingObjects.attemptId),
        )
        .where(eq(chapterProcessingObjects.id, candidate.id))
        .limit(1);
      if (
        !object ||
        object.chapterId !== candidate.chapterId ||
        object.storageKey !== candidate.storageKey ||
        object.checksum !== candidate.checksum ||
        !["reserved", "created", "cleanup_pending"].includes(object.status) ||
        !["retryable_failed", "terminal_failed"].includes(object.attemptStatus)
      )
        return false;
      const [published] = await tx
        .select({ id: imageVersions.id })
        .from(imageVersions)
        .where(eq(imageVersions.storageKey, candidate.storageKey))
        .limit(1);
      if (published) return false;
      await cleanup();
      await tx
        .update(chapterProcessingObjects)
        .set({ status: "cleaned", updatedAt: new Date() })
        .where(eq(chapterProcessingObjects.id, candidate.id));
      return true;
    });
  }
  async markAttemptFailed(attempt: AttemptWork, code: string): Promise<void> {
    const uploadId = attempt.uploadId;
    if (!uploadId) throw new Error("attempt-upload-unknown");
    await this.db.transaction(async (tx) => {
      const [currentAttempt] = await tx
        .select({ status: chapterProcessingAttempts.status })
        .from(chapterProcessingAttempts)
        .where(eq(chapterProcessingAttempts.id, attempt.id))
        .limit(1)
        .for("update");
      if (currentAttempt?.status !== "processing") return;
      const state = await transitionChapterState(tx, {
        chapterId: attempt.chapterId,
        transition: "processing-failed",
        expectedStates: ["processing"],
      });
      if (!state.transitioned) throw new Error("stale-attempt-state-changed");
      await tx
        .update(chapterProcessingAttempts)
        .set({
          status: "terminal_failed",
          errorCode: code,
          errorMessage: "Job exhausted before a durable result was recorded",
          finishedAt: new Date(),
        })
        .where(eq(chapterProcessingAttempts.id, attempt.id));
      await tx
        .update(chapterImportItems)
        .set({ status: "failed", errorCode: code, updatedAt: new Date() })
        .where(eq(chapterImportItems.uploadId, uploadId));
      await tx
        .update(chapterProcessingObjects)
        .set({ status: "cleanup_pending", updatedAt: new Date() })
        .where(
          and(
            eq(chapterProcessingObjects.attemptId, attempt.id),
            eq(chapterProcessingObjects.status, "created"),
          ),
        );
    });
  }
}
