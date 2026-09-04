import { and, asc, eq } from "drizzle-orm";
import type { NodeProxDatabase } from "../../../../../../../../database/client.js";
import {
  chapterReplacementItems,
  chapterReplacementOperations,
} from "../../../../../../../../database/schema/index.js";
import type { ChapterReplacementManifestRepository } from "../../../application/ports/chapter-replacement-manifest.repository.js";
import type { ChapterReplacementOperationRepository } from "../../../application/ports/chapter-replacement-operation.repository.js";
import type { ChapterReplacementItem } from "../../../domain/chapter-replacement-item.js";
import type { ChapterReplacementOperation } from "../../../domain/chapter-replacement-operation.js";
import type { ChapterReplacementResult } from "../../../domain/chapter-replacement-result.js";

export class DrizzleChapterReplacementRepository
  implements
    ChapterReplacementOperationRepository,
    ChapterReplacementManifestRepository
{
  constructor(private readonly db: NodeProxDatabase) {}

  async create(
    input: Parameters<ChapterReplacementOperationRepository["create"]>[0],
  ): Promise<ChapterReplacementOperation> {
    const [row] = await this.db
      .insert(chapterReplacementOperations)
      .values(input)
      .returning();
    if (!row) throw new Error("chapter-replacement-operation-create-failed");
    return row;
  }

  async findById(id: string): Promise<ChapterReplacementOperation | null> {
    const [row] = await this.db
      .select()
      .from(chapterReplacementOperations)
      .where(eq(chapterReplacementOperations.id, id))
      .limit(1);
    return row ?? null;
  }

  async findByIdForChapter(
    replacementId: string,
    chapterId: string,
  ): Promise<ChapterReplacementOperation | null> {
    const [row] = await this.db
      .select()
      .from(chapterReplacementOperations)
      .where(
        and(
          eq(chapterReplacementOperations.id, replacementId),
          eq(chapterReplacementOperations.chapterId, chapterId),
        ),
      )
      .limit(1);
    return row ?? null;
  }

  async getCompletedResult(
    replacementId: string,
  ): Promise<ChapterReplacementResult | null> {
    const operation = await this.findById(replacementId);
    return operation ? completedResult(operation) : null;
  }

  async createItems(
    items: Parameters<ChapterReplacementManifestRepository["createItems"]>[0],
  ): Promise<readonly ChapterReplacementItem[]> {
    if (items.length === 0) return [];
    const rows = await this.db
      .insert(chapterReplacementItems)
      .values([...items])
      .returning();
    return rows;
  }

  async findByOperationId(
    operationId: string,
  ): Promise<readonly ChapterReplacementItem[]> {
    return this.db
      .select()
      .from(chapterReplacementItems)
      .where(eq(chapterReplacementItems.operationId, operationId))
      .orderBy(
        asc(chapterReplacementItems.sortOrder),
        asc(chapterReplacementItems.id),
      );
  }
}

function completedResult(
  operation: ChapterReplacementOperation,
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
