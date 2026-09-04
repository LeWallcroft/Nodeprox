import { and, asc, eq, lte, sql } from "drizzle-orm";
import type { NodeProxDatabase } from "../../../../../../../../database/client.js";
import {
  chapterReplacementOperations,
  chapterReplacementProcessingOutbox,
  chapters,
} from "../../../../../../../../database/schema/index.js";
import type {
  ChapterReplacementProcessingOutboxPort,
  ChapterReplacementUploadRepository,
} from "../../../application/ports/chapter-replacement-upload.repository.js";
import type { ChapterReplacementOperation } from "../../../domain/chapter-replacement-operation.js";
import type { ChapterReplacementResult } from "../../../domain/chapter-replacement-result.js";

export class DrizzleChapterReplacementProcessingRepository
  implements
    ChapterReplacementUploadRepository,
    ChapterReplacementProcessingOutboxPort
{
  constructor(private readonly db: NodeProxDatabase) {}

  async createPending(
    input: Parameters<ChapterReplacementUploadRepository["createPending"]>[0],
  ): Promise<ChapterReplacementOperation | null> {
    try {
      return await this.db.transaction(async (tx) => {
        const [chapter] = await tx
          .select({ id: chapters.id })
          .from(chapters)
          .where(
            and(eq(chapters.id, input.chapterId), eq(chapters.status, "ready")),
          )
          .limit(1)
          .for("update");
        if (!chapter) return null;
        const [operation] = await tx
          .insert(chapterReplacementOperations)
          .values(input)
          .returning();
        return operation ?? null;
      });
    } catch (error) {
      if (isUniqueViolation(error)) return null;
      throw error;
    }
  }

  async markPreparationFailed(
    replacementId: string,
    code: string,
  ): Promise<void> {
    await this.db
      .update(chapterReplacementOperations)
      .set({ status: "failed", lastErrorCode: code, updatedAt: new Date() })
      .where(
        and(
          eq(chapterReplacementOperations.id, replacementId),
          eq(chapterReplacementOperations.status, "pending_upload"),
        ),
      );
  }

  async findByIdForChapter(replacementId: string, chapterId: string) {
    const [operation] = await this.db
      .select()
      .from(chapterReplacementOperations)
      .where(
        and(
          eq(chapterReplacementOperations.id, replacementId),
          eq(chapterReplacementOperations.chapterId, chapterId),
        ),
      )
      .limit(1);
    return operation ?? null;
  }

  async getCompletedResult(
    replacementId: string,
  ): Promise<ChapterReplacementResult | null> {
    const [operation] = await this.db
      .select()
      .from(chapterReplacementOperations)
      .where(eq(chapterReplacementOperations.id, replacementId))
      .limit(1);
    return operation ? completedResult(operation) : null;
  }

  async markUploadedAndEnqueue(
    input: Parameters<
      ChapterReplacementUploadRepository["markUploadedAndEnqueue"]
    >[0],
  ) {
    return this.db.transaction(async (tx) => {
      const [current] = await tx
        .select()
        .from(chapterReplacementOperations)
        .where(
          and(
            eq(chapterReplacementOperations.id, input.replacementId),
            eq(chapterReplacementOperations.chapterId, input.chapterId),
          ),
        )
        .limit(1)
        .for("update");
      if (!current) return null;
      if (current.status !== "pending_upload") return current;
      const now = new Date();
      const [uploaded] = await tx
        .update(chapterReplacementOperations)
        .set({
          status: "uploaded",
          ...(input.etag ? { etag: input.etag } : {}),
          updatedAt: now,
        })
        .where(
          and(
            eq(chapterReplacementOperations.id, current.id),
            eq(chapterReplacementOperations.status, "pending_upload"),
          ),
        )
        .returning();
      if (!uploaded) throw new Error("chapter-replacement-upload-conflict");
      await tx
        .insert(chapterReplacementProcessingOutbox)
        .values({ replacementId: uploaded.id, chapterId: uploaded.chapterId })
        .onConflictDoNothing();
      return uploaded;
    });
  }

  async findPending(limit: number) {
    const rows = await this.db
      .select({
        id: chapterReplacementProcessingOutbox.id,
        replacementId: chapterReplacementProcessingOutbox.replacementId,
        chapterId: chapterReplacementProcessingOutbox.chapterId,
      })
      .from(chapterReplacementProcessingOutbox)
      .where(
        and(
          eq(chapterReplacementProcessingOutbox.status, "pending"),
          lte(chapterReplacementProcessingOutbox.availableAt, new Date()),
        ),
      )
      .orderBy(asc(chapterReplacementProcessingOutbox.createdAt))
      .limit(Math.max(1, Math.min(limit, 20)));
    return rows;
  }

  async markEnqueued(id: string): Promise<void> {
    await this.db
      .update(chapterReplacementProcessingOutbox)
      .set({
        status: "enqueued",
        attempts: sql`${chapterReplacementProcessingOutbox.attempts} + 1`,
        enqueuedAt: new Date(),
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(chapterReplacementProcessingOutbox.id, id),
          eq(chapterReplacementProcessingOutbox.status, "pending"),
        ),
      );
  }
}

function completedResult(
  operation: typeof chapterReplacementOperations.$inferSelect,
): ChapterReplacementResult | null {
  if (
    operation.status !== "completed" ||
    operation.completedAt === null ||
    operation.previousImageCount === null ||
    operation.resultImageCount === null ||
    operation.retainedImageCount === null ||
    operation.createdImageCount === null ||
    operation.retiredImageCount === null
  )
    return null;
  return {
    replacementId: operation.id,
    chapterId: operation.chapterId,
    previousImageCount: operation.previousImageCount,
    imageCount: operation.resultImageCount,
    retainedImageCount: operation.retainedImageCount,
    createdImageCount: operation.createdImageCount,
    retiredImageCount: operation.retiredImageCount,
    completedAt: operation.completedAt,
  };
}

function isUniqueViolation(error: unknown): boolean {
  if (typeof error !== "object" || error === null) return false;
  if ("code" in error && error.code === "23505") return true;
  return "cause" in error && isUniqueViolation(error.cause);
}
