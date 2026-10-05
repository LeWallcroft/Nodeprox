import { aliasedTable, and, asc, desc, eq, isNull, sql } from "drizzle-orm";
import type { NodeProxDatabase } from "../../../../../../../../database/client.js";
import {
  chapterReplacementItems,
  chapterReplacementOperations,
  chapterReplacementProcessingAttempts,
  chapters,
  domainEventOutbox,
  images,
  imageVersions,
  series,
  storageCleanupOutbox,
  uploadValidationEntries,
  uploadValidationRuns,
} from "../../../../../../../../database/schema/index.js";
import type {
  ChapterReplacementManifestItem,
  ChapterReplacementProcessingRepositoryPort,
} from "../../../application/ports.js";

export class DrizzleChapterReplacementProcessingWorkerRepository
  implements ChapterReplacementProcessingRepositoryPort
{
  constructor(private readonly db: NodeProxDatabase) {}

  async loadAdmissionManifest(replacementId: string) {
    const [run] = await this.db
      .select({ id: uploadValidationRuns.id })
      .from(uploadValidationRuns)
      .where(
        and(
          eq(uploadValidationRuns.replacementId, replacementId),
          eq(uploadValidationRuns.status, "accepted"),
        ),
      )
      .orderBy(desc(uploadValidationRuns.startedAt))
      .limit(1);
    if (!run) return null;
    const entries = await this.db
      .select()
      .from(uploadValidationEntries)
      .where(eq(uploadValidationEntries.runId, run.id));
    return entries.map((entry) => ({
      filename: entry.filename,
      extension: entry.extension,
      contentType: entry.contentType,
      sortOrder: entry.sortOrder,
      sizeBytes: entry.sizeBytes,
      checksumSha256: entry.checksumSha256,
      ...(entry.widthPx !== null ? { widthPx: entry.widthPx } : {}),
      ...(entry.heightPx !== null ? { heightPx: entry.heightPx } : {}),
      warnings: entry.warnings,
    }));
  }

  async markRetryExhausted(
    replacementId: string,
    errorCode: string,
  ): Promise<boolean> {
    return this.db.transaction(async (tx) => {
      const [updated] = await tx
        .update(chapterReplacementOperations)
        .set({
          status: "retry_exhausted",
          lastErrorCode: errorCode.slice(0, 100),
          updatedAt: new Date(),
        })
        .where(
          and(
            eq(chapterReplacementOperations.id, replacementId),
            eq(chapterReplacementOperations.status, "processing"),
          ),
        )
        .returning({ id: chapterReplacementOperations.id });
      if (!updated) return false;
      await tx
        .update(chapterReplacementProcessingAttempts)
        .set({
          status: "retry_exhausted",
          errorCode: errorCode.slice(0, 100),
          finishedAt: new Date(),
        })
        .where(
          and(
            eq(
              chapterReplacementProcessingAttempts.replacementId,
              replacementId,
            ),
            eq(chapterReplacementProcessingAttempts.status, "processing"),
          ),
        );
      return true;
    });
  }

  async markRetryableFailed(
    replacementId: string,
    errorCode: string,
  ): Promise<void> {
    await this.db
      .update(chapterReplacementProcessingAttempts)
      .set({
        status: "retryable_failed",
        errorCode: errorCode.slice(0, 100),
        finishedAt: new Date(),
      })
      .where(
        and(
          eq(chapterReplacementProcessingAttempts.replacementId, replacementId),
          eq(chapterReplacementProcessingAttempts.status, "processing"),
        ),
      );
  }

  async claimForProcessing(
    input: Parameters<
      ChapterReplacementProcessingRepositoryPort["claimForProcessing"]
    >[0],
  ) {
    return this.db.transaction(async (tx) => {
      const [operation] = await tx
        .select({
          replacementId: chapterReplacementOperations.id,
          chapterId: chapterReplacementOperations.chapterId,
          requestedByUserId: chapterReplacementOperations.requestedByUserId,
          sourceStorageKey: chapterReplacementOperations.candidateZipStorageKey,
          storageProfileId: chapterReplacementOperations.storageProfileId,
          status: chapterReplacementOperations.status,
          seriesSlug: series.slug,
          chapterPublicKey: chapters.publicKey,
        })
        .from(chapterReplacementOperations)
        .innerJoin(
          chapters,
          eq(chapters.id, chapterReplacementOperations.chapterId),
        )
        .innerJoin(series, eq(series.id, chapters.seriesId))
        .where(
          and(
            eq(chapterReplacementOperations.id, input.replacementId),
            eq(chapterReplacementOperations.chapterId, input.chapterId),
          ),
        )
        .limit(1)
        .for("update");
      if (!operation) return { outcome: "not-found" as const };
      const initialVersion = aliasedTable(
        imageVersions,
        "initial_image_version",
      );
      const activeImages = await tx
        .select({
          sortOrder: images.sortOrder,
          logicalFilename: initialVersion.physicalFilename,
          currentVersion: imageVersions.version,
        })
        .from(images)
        .innerJoin(imageVersions, eq(images.currentVersionId, imageVersions.id))
        .innerJoin(
          initialVersion,
          and(
            eq(initialVersion.imageId, images.id),
            eq(initialVersion.version, 1),
          ),
        )
        .where(
          and(
            eq(images.chapterId, operation.chapterId),
            isNull(images.retiredAt),
          ),
        )
        .orderBy(asc(images.sortOrder));
      if (
        operation.status === "ready" ||
        operation.status === "completing" ||
        operation.status === "completed" ||
        operation.status === "failed"
      )
        return { outcome: "noop" as const };
      if (operation.status === "processing") {
        const [active] = await tx
          .select()
          .from(chapterReplacementProcessingAttempts)
          .where(
            and(
              eq(
                chapterReplacementProcessingAttempts.replacementId,
                operation.replacementId,
              ),
              eq(chapterReplacementProcessingAttempts.status, "processing"),
            ),
          )
          .orderBy(desc(chapterReplacementProcessingAttempts.attemptNumber))
          .limit(1)
          .for("update");
        if (active) {
          if (
            !input.jobId ||
            active.jobId !== input.jobId ||
            (input.jobAttempt ?? 0) <= (active.jobAttempt ?? 0)
          )
            return { outcome: "noop" as const };
          await tx
            .update(chapterReplacementProcessingAttempts)
            .set({
              status: "retryable_failed",
              errorCode: "JOB_REDELIVERED",
              finishedAt: new Date(),
            })
            .where(eq(chapterReplacementProcessingAttempts.id, active.id));
        }
      }
      if (operation.status === "uploaded") {
        const [claimed] = await tx
          .update(chapterReplacementOperations)
          .set({ status: "processing", updatedAt: new Date() })
          .where(
            and(
              eq(chapterReplacementOperations.id, operation.replacementId),
              eq(chapterReplacementOperations.status, "uploaded"),
            ),
          )
          .returning({ id: chapterReplacementOperations.id });
        if (!claimed) return { outcome: "noop" as const };
      } else if (operation.status !== "processing") {
        return { outcome: "noop" as const };
      }
      const [validation] = await tx
        .select({ id: uploadValidationRuns.id })
        .from(uploadValidationRuns)
        .where(
          and(
            eq(uploadValidationRuns.replacementId, operation.replacementId),
            eq(uploadValidationRuns.status, "accepted"),
          ),
        )
        .orderBy(desc(uploadValidationRuns.startedAt))
        .limit(1);
      if (!validation)
        throw new Error("replacement-admission-manifest-missing");
      const [sequence] = await tx
        .select({
          next: sql<number>`coalesce(max(${chapterReplacementProcessingAttempts.attemptNumber}), 0) + 1`.mapWith(
            Number,
          ),
        })
        .from(chapterReplacementProcessingAttempts)
        .where(
          eq(
            chapterReplacementProcessingAttempts.replacementId,
            operation.replacementId,
          ),
        );
      await tx.insert(chapterReplacementProcessingAttempts).values({
        replacementId: operation.replacementId,
        validationRunId: validation.id,
        attemptNumber: sequence?.next ?? 1,
        ...(input.jobId ? { jobId: input.jobId } : {}),
        ...(input.jobAttempt ? { jobAttempt: input.jobAttempt } : {}),
        ...(input.originRequestId ? { requestId: input.originRequestId } : {}),
      });
      return {
        outcome: "process" as const,
        context: {
          replacementId: operation.replacementId,
          chapterId: operation.chapterId,
          requestedByUserId: operation.requestedByUserId,
          sourceStorageKey: operation.sourceStorageKey,
          storageProfileId: operation.storageProfileId,
          seriesSlug: operation.seriesSlug,
          chapterPublicKey: operation.chapterPublicKey,
          status: "processing" as const,
          activeImages,
        },
      };
    });
  }

  async createOrLoadManifest(
    replacementId: string,
    plan: Parameters<
      ChapterReplacementProcessingRepositoryPort["createOrLoadManifest"]
    >[1],
  ): Promise<readonly ChapterReplacementManifestItem[]> {
    return this.db.transaction(async (tx) => {
      const [operation] = await tx
        .select({
          status: chapterReplacementOperations.status,
          storageProfileId: chapterReplacementOperations.storageProfileId,
        })
        .from(chapterReplacementOperations)
        .where(eq(chapterReplacementOperations.id, replacementId))
        .limit(1)
        .for("update");
      if (operation?.status !== "processing")
        throw new Error("chapter-replacement-processing-state-conflict");
      if (
        plan.some(
          (item) => item.storageProfileId !== operation.storageProfileId,
        )
      )
        throw new Error("chapter-replacement-profile-mismatch");
      let rows = await tx
        .select()
        .from(chapterReplacementItems)
        .where(eq(chapterReplacementItems.operationId, replacementId))
        .orderBy(asc(chapterReplacementItems.sortOrder));
      if (rows.length === 0) {
        if (plan.length === 0)
          throw new Error("chapter-replacement-manifest-empty");
        rows = await tx
          .insert(chapterReplacementItems)
          .values([...plan])
          .returning();
        rows.sort((left, right) => left.sortOrder - right.sortOrder);
      }
      return rows;
    });
  }

  async markCandidateStored(
    input: Parameters<
      ChapterReplacementProcessingRepositoryPort["markCandidateStored"]
    >[0],
  ): Promise<boolean> {
    return this.db.transaction(async (tx) => {
      const [operation] = await tx
        .select({ status: chapterReplacementOperations.status })
        .from(chapterReplacementOperations)
        .where(eq(chapterReplacementOperations.id, input.replacementId))
        .limit(1)
        .for("update");
      if (operation?.status !== "processing") return false;
      const [stored] = await tx
        .update(chapterReplacementItems)
        .set({
          sizeBytes: input.sizeBytes,
          ...(input.etag ? { etag: input.etag } : {}),
          storedAt: input.storedAt,
          updatedAt: input.storedAt,
        })
        .where(
          and(
            eq(chapterReplacementItems.id, input.itemId),
            eq(chapterReplacementItems.operationId, input.replacementId),
            sql`${chapterReplacementItems.storedAt} is null`,
          ),
        )
        .returning({ id: chapterReplacementItems.id });
      if (stored) return true;
      const [existing] = await tx
        .select({ storedAt: chapterReplacementItems.storedAt })
        .from(chapterReplacementItems)
        .where(
          and(
            eq(chapterReplacementItems.id, input.itemId),
            eq(chapterReplacementItems.operationId, input.replacementId),
          ),
        )
        .limit(1);
      return existing?.storedAt !== null;
    });
  }

  async markReady(
    replacementId: string,
    originRequestId?: string,
  ): Promise<boolean> {
    return this.db.transaction(async (tx) => {
      const [operation] = await tx
        .select({
          id: chapterReplacementOperations.id,
          status: chapterReplacementOperations.status,
          requestedByUserId: chapterReplacementOperations.requestedByUserId,
          chapterId: chapterReplacementOperations.chapterId,
          sourceStorageKey: chapterReplacementOperations.candidateZipStorageKey,
          storageProfileId: chapterReplacementOperations.storageProfileId,
        })
        .from(chapterReplacementOperations)
        .where(eq(chapterReplacementOperations.id, replacementId))
        .limit(1)
        .for("update");
      if (!operation) return false;
      if (operation.status === "ready") return true;
      if (operation.status !== "processing") return false;
      const items = await tx
        .select({
          sortOrder: chapterReplacementItems.sortOrder,
          storedAt: chapterReplacementItems.storedAt,
        })
        .from(chapterReplacementItems)
        .where(eq(chapterReplacementItems.operationId, replacementId))
        .orderBy(asc(chapterReplacementItems.sortOrder))
        .for("update");
      if (!manifestReady(items)) return false;
      const [ready] = await tx
        .update(chapterReplacementOperations)
        .set({ status: "ready", lastErrorCode: null, updatedAt: new Date() })
        .where(
          and(
            eq(chapterReplacementOperations.id, replacementId),
            eq(chapterReplacementOperations.status, "processing"),
          ),
        )
        .returning({ id: chapterReplacementOperations.id });
      if (!ready) return false;
      await tx
        .update(chapterReplacementProcessingAttempts)
        .set({ status: "succeeded", finishedAt: new Date() })
        .where(
          and(
            eq(
              chapterReplacementProcessingAttempts.replacementId,
              replacementId,
            ),
            eq(chapterReplacementProcessingAttempts.status, "processing"),
          ),
        );
      await tx.insert(domainEventOutbox).values({
        eventType: "chapter.replacement.ready",
        aggregateType: "chapter_replacement",
        aggregateId: replacementId,
        actorUserId: operation.requestedByUserId,
        payload: {
          targetUserId: operation.requestedByUserId,
          chapterId: operation.chapterId,
        },
      });
      await tx
        .insert(storageCleanupOutbox)
        .values({
          replacementId,
          storageProfileId: operation.storageProfileId,
          storageKey: operation.sourceStorageKey,
          reason: "replacement_source_zip",
          ...(originRequestId ? { originRequestId } : {}),
        })
        .onConflictDoNothing();
      return true;
    });
  }

  async markFailed(
    replacementId: string,
    errorCode: string,
    originRequestId?: string,
  ): Promise<boolean> {
    return this.db.transaction(async (tx) => {
      const [operation] = await tx
        .select({
          id: chapterReplacementOperations.id,
          status: chapterReplacementOperations.status,
          requestedByUserId: chapterReplacementOperations.requestedByUserId,
          chapterId: chapterReplacementOperations.chapterId,
          sourceStorageKey: chapterReplacementOperations.candidateZipStorageKey,
          storageProfileId: chapterReplacementOperations.storageProfileId,
        })
        .from(chapterReplacementOperations)
        .where(eq(chapterReplacementOperations.id, replacementId))
        .limit(1)
        .for("update");
      if (!operation) return false;
      if (operation.status === "failed") return true;
      if (operation.status !== "processing") return false;
      const items = await tx
        .select({
          storageKey: chapterReplacementItems.candidateStorageKey,
          storageProfileId: chapterReplacementItems.storageProfileId,
        })
        .from(chapterReplacementItems)
        .where(eq(chapterReplacementItems.operationId, replacementId));
      const [failed] = await tx
        .update(chapterReplacementOperations)
        .set({
          status: "failed",
          lastErrorCode: errorCode,
          updatedAt: new Date(),
        })
        .where(
          and(
            eq(chapterReplacementOperations.id, replacementId),
            eq(chapterReplacementOperations.status, "processing"),
          ),
        )
        .returning({ id: chapterReplacementOperations.id });
      if (!failed) return false;
      await tx
        .update(chapterReplacementProcessingAttempts)
        .set({
          status: "terminal_failed",
          errorCode: errorCode.slice(0, 100),
          finishedAt: new Date(),
        })
        .where(
          and(
            eq(
              chapterReplacementProcessingAttempts.replacementId,
              replacementId,
            ),
            eq(chapterReplacementProcessingAttempts.status, "processing"),
          ),
        );
      await tx.insert(domainEventOutbox).values({
        eventType: "upload.failed",
        aggregateType: "chapter_replacement",
        aggregateId: replacementId,
        actorUserId: operation.requestedByUserId,
        payload: {
          targetUserId: operation.requestedByUserId,
          chapterId: operation.chapterId,
          operationKind: "chapter_replacement",
          errorCode,
        },
      });
      if (items.length > 0)
        await tx
          .insert(storageCleanupOutbox)
          .values(
            items.map((item) => ({
              replacementId,
              storageProfileId: item.storageProfileId,
              storageKey: item.storageKey,
              reason: "replacement_failed_candidate" as const,
              ...(originRequestId ? { originRequestId } : {}),
            })),
          )
          .onConflictDoNothing();
      return true;
    });
  }
}

function manifestReady(
  items: readonly { sortOrder: number; storedAt: Date | null }[],
): boolean {
  if (items.length === 0 || items.some((item) => item.storedAt === null))
    return false;
  const first = items[0]?.sortOrder;
  return (
    first !== undefined &&
    items.every((item, index) => item.sortOrder === first + index)
  );
}
