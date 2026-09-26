import { and, eq, ne } from "drizzle-orm";
import type { NodeProxDatabase } from "../../../../../../../database/client.js";
import {
  auditLogs,
  chapterDeletionOutbox,
  chapterProcessingAttempts,
  chapterProcessingObjects,
  chapters,
  images,
  imageVersions,
  uploads,
} from "../../../../../../../database/schema/index.js";
import type { ChapterDeletionRepositoryPort } from "../../../application/ports.js";

export class DrizzleChapterDeletionRepository
  implements ChapterDeletionRepositoryPort
{
  constructor(private readonly db: NodeProxDatabase) {}

  async load(deletionId: string, chapterId: string) {
    const [request] = await this.db
      .select({
        requestedBy: chapterDeletionOutbox.requestedBy,
        originRequestId: chapterDeletionOutbox.originRequestId,
      })
      .from(chapterDeletionOutbox)
      .where(
        and(
          eq(chapterDeletionOutbox.id, deletionId),
          eq(chapterDeletionOutbox.chapterId, chapterId),
          ne(chapterDeletionOutbox.status, "completed"),
        ),
      )
      .limit(1);
    if (!request) return null;
    const imageRows = await this.db
      .select({ key: images.storageKey })
      .from(images)
      .where(eq(images.chapterId, chapterId));
    const imageVersionRows = await this.db
      .select({ key: imageVersions.storageKey })
      .from(imageVersions)
      .innerJoin(images, eq(images.id, imageVersions.imageId))
      .where(eq(images.chapterId, chapterId));
    const uploadRows = await this.db
      .select({ key: uploads.storageKey })
      .from(uploads)
      .where(eq(uploads.chapterId, chapterId));
    const candidateRows = await this.db
      .select({ key: chapterProcessingObjects.storageKey })
      .from(chapterProcessingObjects)
      .innerJoin(
        chapterProcessingAttempts,
        eq(chapterProcessingAttempts.id, chapterProcessingObjects.attemptId),
      )
      .where(eq(chapterProcessingAttempts.chapterId, chapterId));
    return {
      deletionId,
      chapterId,
      requestedBy: request.requestedBy,
      originRequestId: request.originRequestId,
      storageKeys: [
        ...new Set(
          [
            ...imageRows,
            ...imageVersionRows,
            ...uploadRows,
            ...candidateRows,
          ].map((row) => row.key),
        ),
      ],
    };
  }

  async finalize(deletionId: string, chapterId: string): Promise<void> {
    await this.db.transaction(async (tx) => {
      const [request] = await tx
        .select({
          status: chapterDeletionOutbox.status,
          requestedBy: chapterDeletionOutbox.requestedBy,
          originRequestId: chapterDeletionOutbox.originRequestId,
        })
        .from(chapterDeletionOutbox)
        .where(
          and(
            eq(chapterDeletionOutbox.id, deletionId),
            eq(chapterDeletionOutbox.chapterId, chapterId),
          ),
        )
        .limit(1)
        .for("update");
      if (!request || request.status === "completed") return;
      const [deleted] = await tx
        .delete(chapters)
        .where(and(eq(chapters.id, chapterId), eq(chapters.status, "deleting")))
        .returning({ id: chapters.id });
      if (!deleted) {
        const [existing] = await tx
          .select({ id: chapters.id })
          .from(chapters)
          .where(eq(chapters.id, chapterId))
          .limit(1);
        if (existing) throw new Error("chapter-deletion-state-conflict");
      }
      await tx.insert(auditLogs).values({
        actorId: request.requestedBy,
        action: "chapter.deleted",
        resourceType: "chapter",
        resourceId: chapterId,
        result: "success",
        ...(request.originRequestId
          ? { requestId: request.originRequestId }
          : {}),
        metadata: { result: "completed" },
      });
      await tx
        .update(chapterDeletionOutbox)
        .set({
          status: "completed",
          completedAt: new Date(),
          updatedAt: new Date(),
        })
        .where(eq(chapterDeletionOutbox.id, deletionId));
    });
  }
}
