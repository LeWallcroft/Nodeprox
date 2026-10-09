import { and, desc, eq } from "drizzle-orm";
import type { NodeProxDatabase } from "../../../../../../../../database/client.js";
import {
  chapterImportItems,
  chapterProcessingAttempts,
  chapterReplacementOperations,
  chapterReplacementProcessingOutbox,
  chapters,
  processingOutbox,
  uploads,
  uploadValidationEntries,
  uploadValidationIssues,
  uploadValidationOutbox,
  uploadValidationRuns,
} from "../../../../../../../../database/schema/index.js";
import type {
  RetryableUploadKind,
  RetryableUploadOperation,
  RetryUploadOperationRepositoryPort,
} from "../../../application/services/retry-upload-operation.service.js";

export class DrizzleRetryUploadOperationRepository
  implements RetryUploadOperationRepositoryPort
{
  constructor(private readonly db: NodeProxDatabase) {}

  async find(
    kind: RetryableUploadKind,
    id: string,
  ): Promise<RetryableUploadOperation | null> {
    if (kind === "chapter_upload") {
      const [upload] = await this.db
        .select()
        .from(uploads)
        .where(eq(uploads.id, id))
        .limit(1);
      if (!upload) return null;
      const [attempt] = await this.db
        .select({ status: chapterProcessingAttempts.status })
        .from(chapterProcessingAttempts)
        .where(eq(chapterProcessingAttempts.uploadId, id))
        .orderBy(desc(chapterProcessingAttempts.attemptNumber))
        .limit(1);
      return {
        kind,
        id,
        chapterId: upload.chapterId,
        storageKey: upload.storageKey,
        storageProfileId: upload.storageProfileId,
        status:
          upload.status === "retry_exhausted"
            ? "retry_exhausted"
            : (attempt?.status ?? upload.status),
        stage: upload.status === "retry_exhausted" ? "admission" : "processing",
      };
    }
    if (kind === "chapter_import") {
      const [row] = await this.db
        .select({
          id: chapterImportItems.id,
          chapterId: uploads.chapterId,
          storageKey: uploads.storageKey,
          storageProfileId: uploads.storageProfileId,
          status: chapterImportItems.status,
          uploadStatus: uploads.status,
        })
        .from(chapterImportItems)
        .innerJoin(uploads, eq(chapterImportItems.uploadId, uploads.id))
        .where(eq(chapterImportItems.id, id))
        .limit(1);
      return row
        ? {
            kind,
            id,
            chapterId: row.chapterId,
            storageKey: row.storageKey,
            storageProfileId: row.storageProfileId,
            status: row.status,
            stage:
              row.uploadStatus === "retry_exhausted"
                ? "admission"
                : "processing",
          }
        : null;
    }
    const [row] = await this.db
      .select()
      .from(chapterReplacementOperations)
      .where(eq(chapterReplacementOperations.id, id))
      .limit(1);
    if (!row) return null;
    const [accepted] = await this.db
      .select({ id: uploadValidationRuns.id })
      .from(uploadValidationRuns)
      .where(
        and(
          eq(uploadValidationRuns.replacementId, id),
          eq(uploadValidationRuns.status, "accepted"),
        ),
      )
      .limit(1);
    return {
      kind,
      id,
      chapterId: row.chapterId,
      storageKey: row.candidateZipStorageKey,
      storageProfileId: row.storageProfileId,
      status: row.status,
      stage: accepted ? "processing" : "admission",
    };
  }

  async requeue(
    operation: RetryableUploadOperation,
    requestId?: string,
  ): Promise<boolean> {
    return this.db.transaction(async (tx) => {
      if (
        operation.kind === "chapter_import" ||
        operation.kind === "chapter_upload"
      ) {
        let uploadId = operation.id;
        if (operation.kind === "chapter_import") {
          const [item] = await tx
            .select({
              uploadId: chapterImportItems.uploadId,
              status: chapterImportItems.status,
            })
            .from(chapterImportItems)
            .where(eq(chapterImportItems.id, operation.id))
            .limit(1)
            .for("update");
          if (!item?.uploadId || item.status !== "retry_exhausted")
            return false;
          uploadId = item.uploadId;
        }
        const [upload] = await tx
          .select()
          .from(uploads)
          .where(eq(uploads.id, uploadId))
          .limit(1)
          .for("update");
        if (
          !upload ||
          upload.storageKey !== operation.storageKey ||
          upload.storageProfileId !== operation.storageProfileId
        )
          return false;
        if (operation.stage === "admission") {
          if (upload.status !== "retry_exhausted") return false;
          await tx
            .update(uploads)
            .set({ status: "validating", updatedAt: new Date() })
            .where(eq(uploads.id, upload.id));
          if (operation.kind === "chapter_import")
            await tx
              .update(chapterImportItems)
              .set({
                status: "validating",
                errorCode: null,
                updatedAt: new Date(),
              })
              .where(eq(chapterImportItems.id, operation.id));
          await tx.insert(uploadValidationOutbox).values({
            uploadId: upload.id,
            ...(requestId ? { originRequestId: requestId } : {}),
          });
        } else {
          if (upload.status !== "uploaded") return false;
          if (operation.kind === "chapter_upload") {
            const [attempt] = await tx
              .select({ status: chapterProcessingAttempts.status })
              .from(chapterProcessingAttempts)
              .where(eq(chapterProcessingAttempts.uploadId, upload.id))
              .orderBy(desc(chapterProcessingAttempts.attemptNumber))
              .limit(1)
              .for("update");
            if (attempt?.status !== "retry_exhausted") return false;
          }
          const [chapter] = await tx
            .select({ status: chapters.status, seriesId: chapters.seriesId })
            .from(chapters)
            .where(eq(chapters.id, upload.chapterId))
            .limit(1)
            .for("update");
          if (chapter?.status !== "uploaded") return false;
          if (operation.kind === "chapter_import")
            await tx
              .update(chapterImportItems)
              .set({
                status: "uploaded",
                errorCode: null,
                updatedAt: new Date(),
              })
              .where(eq(chapterImportItems.id, operation.id));
          await tx.insert(processingOutbox).values({
            uploadId: upload.id,
            chapterId: upload.chapterId,
            seriesId: chapter.seriesId,
            storageKey: upload.storageKey,
            storageProfileId: upload.storageProfileId,
            ...(requestId ? { originRequestId: requestId } : {}),
          });
        }
        return true;
      }
      const [replacement] = await tx
        .select()
        .from(chapterReplacementOperations)
        .where(eq(chapterReplacementOperations.id, operation.id))
        .limit(1)
        .for("update");
      if (
        replacement?.status !== "retry_exhausted" ||
        replacement.candidateZipStorageKey !== operation.storageKey ||
        replacement.storageProfileId !== operation.storageProfileId
      )
        return false;
      await tx
        .update(chapterReplacementOperations)
        .set({
          status: operation.stage === "admission" ? "validating" : "uploaded",
          lastErrorCode: null,
          updatedAt: new Date(),
        })
        .where(eq(chapterReplacementOperations.id, operation.id));
      if (operation.stage === "admission") {
        await tx.insert(uploadValidationOutbox).values({
          replacementId: operation.id,
          ...(requestId ? { originRequestId: requestId } : {}),
        });
      } else {
        await tx.insert(chapterReplacementProcessingOutbox).values({
          replacementId: operation.id,
          chapterId: replacement.chapterId,
          ...(requestId ? { originRequestId: requestId } : {}),
        });
      }
      return true;
    });
  }

  async report(kind: RetryableUploadKind, id: string) {
    let uploadId: string | null = null;
    if (kind === "chapter_import") {
      const [item] = await this.db
        .select({ uploadId: chapterImportItems.uploadId })
        .from(chapterImportItems)
        .where(eq(chapterImportItems.id, id))
        .limit(1);
      uploadId = item?.uploadId ?? null;
      if (!uploadId) return null;
    } else if (kind === "chapter_upload") {
      uploadId = id;
    }
    const owner =
      kind === "chapter_import" || kind === "chapter_upload"
        ? eq(uploadValidationRuns.uploadId, uploadId as string)
        : eq(uploadValidationRuns.replacementId, id);
    const [run] = await this.db
      .select()
      .from(uploadValidationRuns)
      .where(owner)
      .orderBy(desc(uploadValidationRuns.startedAt))
      .limit(1);
    if (!run) return null;
    const issues = await this.db
      .select({
        id: uploadValidationIssues.id,
        code: uploadValidationIssues.code,
        severity: uploadValidationIssues.severity,
        fileIndex: uploadValidationIssues.fileIndex,
        filename: uploadValidationIssues.filename,
        actual: uploadValidationIssues.actual,
        expected: uploadValidationIssues.expected,
      })
      .from(uploadValidationIssues)
      .where(eq(uploadValidationIssues.runId, run.id));
    const entries = await this.db
      .select({ warnings: uploadValidationEntries.warnings })
      .from(uploadValidationEntries)
      .where(eq(uploadValidationEntries.runId, run.id));
    return {
      validationRunId: run.id,
      requestId: run.requestId,
      status: run.status,
      issues,
      warnings: entries.flatMap((entry) =>
        Array.isArray(entry.warnings) ? entry.warnings : [],
      ),
    };
  }
}
