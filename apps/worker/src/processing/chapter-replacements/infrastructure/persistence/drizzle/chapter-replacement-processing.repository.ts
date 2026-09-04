import { and, asc, eq, sql } from "drizzle-orm";
import type { NodeProxDatabase } from "../../../../../../../../database/client.js";
import {
  chapterReplacementItems,
  chapterReplacementOperations,
  chapters,
  series,
  storageCleanupOutbox,
} from "../../../../../../../../database/schema/index.js";
import type {
  ChapterReplacementManifestItem,
  ChapterReplacementProcessingRepositoryPort,
} from "../../../application/ports.js";

export class DrizzleChapterReplacementProcessingWorkerRepository
  implements ChapterReplacementProcessingRepositoryPort
{
  constructor(private readonly db: NodeProxDatabase) {}

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
      if (
        operation.status === "ready" ||
        operation.status === "completing" ||
        operation.status === "completed" ||
        operation.status === "failed"
      )
        return { outcome: "noop" as const };
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
      return {
        outcome: "process" as const,
        context: {
          replacementId: operation.replacementId,
          chapterId: operation.chapterId,
          requestedByUserId: operation.requestedByUserId,
          sourceStorageKey: operation.sourceStorageKey,
          seriesSlug: operation.seriesSlug,
          chapterPublicKey: operation.chapterPublicKey,
          status: "processing" as const,
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
        .select({ status: chapterReplacementOperations.status })
        .from(chapterReplacementOperations)
        .where(eq(chapterReplacementOperations.id, replacementId))
        .limit(1)
        .for("update");
      if (operation?.status !== "processing")
        throw new Error("chapter-replacement-processing-state-conflict");
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

  async markReady(replacementId: string): Promise<boolean> {
    return this.db.transaction(async (tx) => {
      const [operation] = await tx
        .select({
          id: chapterReplacementOperations.id,
          status: chapterReplacementOperations.status,
          sourceStorageKey: chapterReplacementOperations.candidateZipStorageKey,
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
        .insert(storageCleanupOutbox)
        .values({
          replacementId,
          storageKey: operation.sourceStorageKey,
          reason: "replacement_source_zip",
        })
        .onConflictDoNothing();
      return true;
    });
  }

  async markFailed(replacementId: string, errorCode: string): Promise<boolean> {
    return this.db.transaction(async (tx) => {
      const [operation] = await tx
        .select({
          id: chapterReplacementOperations.id,
          status: chapterReplacementOperations.status,
          sourceStorageKey: chapterReplacementOperations.candidateZipStorageKey,
        })
        .from(chapterReplacementOperations)
        .where(eq(chapterReplacementOperations.id, replacementId))
        .limit(1)
        .for("update");
      if (!operation) return false;
      if (operation.status === "failed") return true;
      if (operation.status !== "processing") return false;
      const items = await tx
        .select({ storageKey: chapterReplacementItems.candidateStorageKey })
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
        .insert(storageCleanupOutbox)
        .values([
          {
            replacementId,
            storageKey: operation.sourceStorageKey,
            reason: "replacement_source_zip" as const,
          },
          ...items.map((item) => ({
            replacementId,
            storageKey: item.storageKey,
            reason: "replacement_failed_candidate" as const,
          })),
        ])
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
