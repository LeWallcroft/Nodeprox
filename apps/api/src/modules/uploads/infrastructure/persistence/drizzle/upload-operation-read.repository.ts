import { desc, eq, inArray, or, sql } from "drizzle-orm";
import type { NodeProxDatabase } from "../../../../../../../../database/client.js";
import {
  chapterImportBatches,
  chapterImportItems,
  chapterProcessingAttempts,
  chapterReplacementOperations,
  chapters,
  imageReplacementOperations,
  series,
  uploads,
  uploadValidationEntries,
  uploadValidationIssues,
  uploadValidationRuns,
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
    const [imports, chapterReplacements, imageReplacements, directUploads] =
      await Promise.all([
        this.db
          .select({
            id: chapterImportItems.id,
            batchId: chapterImportItems.batchId,
            seriesId: series.id,
            seriesTitle: series.title,
            chapterId: chapterImportItems.chapterId,
            chapterNumber: chapterImportItems.chapterNumber,
            filename: chapterImportItems.filename,
            uploadId: chapterImportItems.uploadId,
            status: chapterImportItems.status,
            uploadStatus: uploads.status,
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
          .leftJoin(uploads, eq(uploads.id, chapterImportItems.uploadId))
          .where(eq(chapterImportBatches.createdBy, input.userId))
          .orderBy(
            desc(chapterImportItems.updatedAt),
            desc(chapterImportItems.createdAt),
            desc(chapterImportItems.id),
          )
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
            hasAcceptedAdmission: sql<boolean>`exists (select 1 from ${uploadValidationRuns} where ${uploadValidationRuns.replacementId} = ${chapterReplacementOperations.id} and ${uploadValidationRuns.status} = 'accepted')`,
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
          .orderBy(
            desc(chapterReplacementOperations.updatedAt),
            desc(chapterReplacementOperations.createdAt),
            desc(chapterReplacementOperations.id),
          )
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
          .orderBy(
            desc(imageReplacementOperations.updatedAt),
            desc(imageReplacementOperations.createdAt),
            desc(imageReplacementOperations.id),
          )
          .limit(input.limit),
        this.db
          .select({
            id: uploads.id,
            seriesId: series.id,
            seriesTitle: series.title,
            chapterId: chapters.id,
            chapterNumber: chapters.chapterNumber,
            filename: uploads.originalFilename,
            status: uploads.status,
            chapterStatus: chapters.status,
            latestAttemptStatus: sql<
              string | null
            >`(select status::text from ${chapterProcessingAttempts} where ${chapterProcessingAttempts.uploadId} = ${uploads.id} order by attempt_number desc limit 1)`,
            createdAt: uploads.createdAt,
            updatedAt: uploads.updatedAt,
          })
          .from(uploads)
          .innerJoin(chapters, eq(chapters.id, uploads.chapterId))
          .innerJoin(series, eq(series.id, chapters.seriesId))
          .where(
            sql`${uploads.createdBy} = ${input.userId} and not exists (select 1 from ${chapterImportItems} where ${chapterImportItems.uploadId} = ${uploads.id})`,
          )
          .orderBy(
            desc(uploads.updatedAt),
            desc(uploads.createdAt),
            desc(uploads.id),
          )
          .limit(input.limit),
      ]);

    const uploadIds = [
      ...new Set([
        ...imports.flatMap((row) => (row.uploadId ? [row.uploadId] : [])),
        ...directUploads.map((row) => row.id),
      ]),
    ];
    const replacementIds = chapterReplacements.map((row) => row.id);
    const ownerFilters = [
      ...(uploadIds.length
        ? [inArray(uploadValidationRuns.uploadId, uploadIds)]
        : []),
      ...(replacementIds.length
        ? [inArray(uploadValidationRuns.replacementId, replacementIds)]
        : []),
    ];
    const warningEntries = ownerFilters.length
      ? await this.db
          .select({
            ownerId: sql<string>`coalesce(${uploadValidationRuns.uploadId}, ${uploadValidationRuns.replacementId})`,
            runId: uploadValidationRuns.id,
            warnings: uploadValidationEntries.warnings,
            sizeBytes: uploadValidationEntries.sizeBytes,
            startedAt: uploadValidationRuns.startedAt,
          })
          .from(uploadValidationRuns)
          .innerJoin(
            uploadValidationEntries,
            eq(uploadValidationEntries.runId, uploadValidationRuns.id),
          )
          .where(
            sql`${uploadValidationRuns.status} = 'accepted' and ${or(...ownerFilters)}`,
          )
          .orderBy(desc(uploadValidationRuns.startedAt))
      : [];
    const issueCountRows = ownerFilters.length
      ? await this.db
          .select({
            ownerId: sql<string>`coalesce(${uploadValidationRuns.uploadId}, ${uploadValidationRuns.replacementId})`,
            startedAt: uploadValidationRuns.startedAt,
            issueCount: sql<number>`count(*)::int`,
          })
          .from(uploadValidationRuns)
          .innerJoin(
            uploadValidationIssues,
            eq(uploadValidationIssues.runId, uploadValidationRuns.id),
          )
          .where(
            sql`${uploadValidationRuns.status} = 'rejected' and ${uploadValidationIssues.severity} = 'error' and ${or(...ownerFilters)}`,
          )
          .groupBy(
            uploadValidationRuns.id,
            uploadValidationRuns.uploadId,
            uploadValidationRuns.replacementId,
            uploadValidationRuns.startedAt,
          )
          .orderBy(desc(uploadValidationRuns.startedAt))
      : [];
    const warningCounts = new Map<string, number>();
    const fileCounts = new Map<string, number>();
    const totalSizes = new Map<string, number>();
    const latestRuns = new Map<string, string>();
    for (const row of warningEntries) {
      if (!latestRuns.has(row.ownerId)) latestRuns.set(row.ownerId, row.runId);
    }
    const issueCounts = new Map<string, number>();
    for (const row of issueCountRows) {
      if (!issueCounts.has(row.ownerId))
        issueCounts.set(row.ownerId, row.issueCount);
    }
    for (const row of warningEntries) {
      if (latestRuns.get(row.ownerId) !== row.runId) continue;
      const warnings = Array.isArray(row.warnings) ? row.warnings : [];
      fileCounts.set(row.ownerId, (fileCounts.get(row.ownerId) ?? 0) + 1);
      totalSizes.set(
        row.ownerId,
        (totalSizes.get(row.ownerId) ?? 0) + row.sizeBytes,
      );
      warningCounts.set(
        row.ownerId,
        (warningCounts.get(row.ownerId) ?? 0) + warnings.length,
      );
    }
    const projections: UploadOperationProjection[] = [
      ...imports.map((row) => ({
        ...row,
        kind: "chapter_import" as const,
        warningCount: row.uploadId ? (warningCounts.get(row.uploadId) ?? 0) : 0,
        issueCount: row.uploadId ? (issueCounts.get(row.uploadId) ?? 0) : 0,
        fileCount: row.uploadId ? (fileCounts.get(row.uploadId) ?? null) : null,
        totalSizeBytes: row.uploadId
          ? (totalSizes.get(row.uploadId) ?? null)
          : null,
        failureStage:
          row.status === "rejected" ||
          row.uploadStatus === "retry_exhausted" ||
          row.uploadStatus === "terminal_failed"
            ? ("admission" as const)
            : row.status === "failed" || row.status === "retry_exhausted"
              ? ("processing" as const)
              : null,
        imageId: null,
        completedAt: row.status === "ready" ? row.updatedAt : null,
      })),
      ...chapterReplacements.map((row) => ({
        ...row,
        kind: "chapter_replacement" as const,
        warningCount: warningCounts.get(row.id) ?? 0,
        issueCount: issueCounts.get(row.id) ?? 0,
        fileCount: fileCounts.get(row.id) ?? null,
        totalSizeBytes: totalSizes.get(row.id) ?? null,
        failureStage:
          row.status === "rejected" ||
          ((row.status === "retry_exhausted" ||
            row.status === "terminal_failed") &&
            !row.hasAcceptedAdmission)
            ? ("admission" as const)
            : row.status === "failed" || row.status === "retry_exhausted"
              ? ("processing" as const)
              : null,
        imageId: null,
      })),
      ...imageReplacements.map((row) => ({
        ...row,
        kind: "image_replacement" as const,
        warningCount: 0,
        issueCount: 0,
        fileCount: null,
        totalSizeBytes: null,
        failureStage: row.status === "failed" ? ("storage" as const) : null,
      })),
      ...directUploads.map((row) => {
        const status =
          row.status === "pending" ||
          row.status === "verifying" ||
          row.status === "aborting"
            ? ("uploading" as const)
            : row.status === "uploaded" && row.chapterStatus === "ready"
              ? ("ready" as const)
              : row.status === "uploaded" && row.chapterStatus === "processing"
                ? ("processing" as const)
                : row.status === "uploaded" &&
                    row.latestAttemptStatus === "retry_exhausted"
                  ? ("retry_exhausted" as const)
                  : row.status === "uploaded" && row.chapterStatus === "failed"
                    ? ("failed" as const)
                    : row.status;
        return {
          id: row.id,
          kind: "chapter_upload" as const,
          warningCount: warningCounts.get(row.id) ?? 0,
          issueCount: issueCounts.get(row.id) ?? 0,
          fileCount: fileCounts.get(row.id) ?? null,
          totalSizeBytes: fileCounts.has(row.id)
            ? (totalSizes.get(row.id) ?? 0)
            : null,
          seriesId: row.seriesId,
          seriesTitle: row.seriesTitle,
          chapterId: row.chapterId,
          chapterNumber: row.chapterNumber,
          imageId: null,
          filename: row.filename,
          status,
          errorCode: null,
          failureStage:
            row.status === "rejected" ||
            row.status === "terminal_failed" ||
            row.status === "retry_exhausted"
              ? ("admission" as const)
              : status === "retry_exhausted" || status === "failed"
                ? ("processing" as const)
                : null,
          createdAt: row.createdAt,
          updatedAt: row.updatedAt,
          completedAt: status === "ready" ? row.updatedAt : null,
        };
      }),
    ];
    return projections
      .sort((left, right) => {
        const activityOrder =
          right.updatedAt.getTime() - left.updatedAt.getTime();
        if (activityOrder) return activityOrder;
        const createdAtOrder =
          right.createdAt.getTime() - left.createdAt.getTime();
        return createdAtOrder || right.id.localeCompare(left.id);
      })
      .slice(0, input.limit);
  }
}
