import { desc, eq } from "drizzle-orm";
import type { NodeProxDatabase } from "../../../../../../../../database/client.js";
import {
  chapterImportBatches,
  chapterImportItems,
  chapterReplacementOperations,
  chapters,
  imageReplacementOperations,
  series,
} from "../../../../../../../../database/schema/index.js";
import type {
  UploadOperationProjection,
  UploadOperationReadRepository,
} from "../../../application/services/list-upload-operations.service.js";

export class DrizzleUploadOperationReadRepository
  implements UploadOperationReadRepository
{
  constructor(private readonly db: NodeProxDatabase) {}

  async listForUser(input: { userId: string; limit: number }) {
    const [imports, chapterReplacements, imageReplacements] = await Promise.all(
      [
        this.db
          .select({
            id: chapterImportItems.id,
            seriesId: series.id,
            seriesTitle: series.title,
            chapterId: chapterImportItems.chapterId,
            chapterNumber: chapterImportItems.chapterNumber,
            filename: chapterImportItems.filename,
            status: chapterImportItems.status,
            errorCode: chapterImportItems.errorCode,
            createdAt: chapterImportItems.createdAt,
            updatedAt: chapterImportItems.updatedAt,
          })
          .from(chapterImportItems)
          .innerJoin(
            chapterImportBatches,
            eq(chapterImportBatches.id, chapterImportItems.batchId),
          )
          .innerJoin(series, eq(series.id, chapterImportBatches.seriesId))
          .where(eq(chapterImportBatches.createdBy, input.userId))
          .orderBy(desc(chapterImportItems.updatedAt))
          .limit(input.limit),
        this.db
          .select({
            id: chapterReplacementOperations.id,
            seriesId: series.id,
            seriesTitle: series.title,
            chapterId: chapters.id,
            chapterNumber: chapters.chapterNumber,
            filename: chapterReplacementOperations.originalFilename,
            status: chapterReplacementOperations.status,
            errorCode: chapterReplacementOperations.lastErrorCode,
            createdAt: chapterReplacementOperations.createdAt,
            updatedAt: chapterReplacementOperations.updatedAt,
            completedAt: chapterReplacementOperations.completedAt,
          })
          .from(chapterReplacementOperations)
          .innerJoin(
            chapters,
            eq(chapters.id, chapterReplacementOperations.chapterId),
          )
          .innerJoin(series, eq(series.id, chapters.seriesId))
          .where(
            eq(chapterReplacementOperations.requestedByUserId, input.userId),
          )
          .orderBy(desc(chapterReplacementOperations.updatedAt))
          .limit(input.limit),
        this.db
          .select({
            id: imageReplacementOperations.id,
            seriesId: series.id,
            seriesTitle: series.title,
            chapterId: chapters.id,
            chapterNumber: chapters.chapterNumber,
            imageId: imageReplacementOperations.imageId,
            filename: imageReplacementOperations.originalFilename,
            status: imageReplacementOperations.status,
            errorCode: imageReplacementOperations.lastErrorCode,
            createdAt: imageReplacementOperations.createdAt,
            updatedAt: imageReplacementOperations.updatedAt,
            completedAt: imageReplacementOperations.completedAt,
          })
          .from(imageReplacementOperations)
          .innerJoin(
            chapters,
            eq(chapters.id, imageReplacementOperations.chapterId),
          )
          .innerJoin(series, eq(series.id, chapters.seriesId))
          .where(eq(imageReplacementOperations.requestedByUserId, input.userId))
          .orderBy(desc(imageReplacementOperations.updatedAt))
          .limit(input.limit),
      ],
    );

    const projections: UploadOperationProjection[] = [
      ...imports.map((row) => ({
        ...row,
        kind: "chapter_import" as const,
        imageId: null,
        completedAt: row.status === "ready" ? row.updatedAt : null,
      })),
      ...chapterReplacements.map((row) => ({
        ...row,
        kind: "chapter_replacement" as const,
        imageId: null,
      })),
      ...imageReplacements.map((row) => ({
        ...row,
        kind: "image_replacement" as const,
      })),
    ];
    return projections
      .sort(
        (left, right) => right.updatedAt.getTime() - left.updatedAt.getTime(),
      )
      .slice(0, input.limit);
  }
}
