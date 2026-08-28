import { and, asc, eq, lte } from "drizzle-orm";
import type { NodeProxDatabase } from "../../../../../../../../database/client.js";
import { chapterDeletionOutbox } from "../../../../../../../../database/schema/index.js";
import type { ChapterDeletionOutboxPort } from "../../../application/ports/chapter-deletion-outbox.ports.js";

export class DrizzleChapterDeletionOutboxRepository
  implements ChapterDeletionOutboxPort
{
  constructor(private readonly db: NodeProxDatabase) {}

  async findPending(limit: number) {
    return this.db
      .select({
        deletionId: chapterDeletionOutbox.id,
        chapterId: chapterDeletionOutbox.chapterId,
      })
      .from(chapterDeletionOutbox)
      .where(
        and(
          eq(chapterDeletionOutbox.status, "pending"),
          lte(chapterDeletionOutbox.availableAt, new Date()),
        ),
      )
      .orderBy(asc(chapterDeletionOutbox.createdAt))
      .limit(limit);
  }

  async markEnqueued(deletionId: string): Promise<void> {
    await this.db
      .update(chapterDeletionOutbox)
      .set({
        status: "enqueued",
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(chapterDeletionOutbox.id, deletionId),
          eq(chapterDeletionOutbox.status, "pending"),
        ),
      );
  }
}
