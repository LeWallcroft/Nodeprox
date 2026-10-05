import { and, eq, sql } from "drizzle-orm";
import type { NodeProxDatabase } from "../../../../../../../database/client.js";
import { transitionChapterState } from "../../../../../../../database/chapter-state-transition.js";
import {
  chapterImportItems,
  chapterReplacementOperations,
  chapterReplacementProcessingOutbox,
  chapters,
  processingOutbox,
  uploadValidationEntries,
  uploadValidationIssues,
  uploadValidationRuns,
  uploads,
} from "../../../../../../../database/schema/index.js";
import type {
  AdmissionClaim,
  AdmissionOwner,
  AdmissionValidationRepositoryPort,
} from "../../../application/ports.js";
import type {
  AdmissionValidationResult,
  ValidationIssue,
} from "../../../domain/admission-validation.types.js";

export class DrizzleAdmissionValidationRepository
  implements AdmissionValidationRepositoryPort
{
  constructor(private readonly db: NodeProxDatabase) {}

  async begin(
    input: AdmissionOwner & {
      jobId: string;
      jobAttempt: number;
      requestId?: string;
    },
  ): Promise<AdmissionClaim | null> {
    return this.db.transaction(async (tx) => {
      if (input.uploadId) {
        const [upload] = await tx
          .select()
          .from(uploads)
          .where(eq(uploads.id, input.uploadId))
          .limit(1)
          .for("update");
        if (upload?.status !== "validating") return null;
        const runId = await createOrResumeRun(tx, input);
        return {
          runId,
          chapterId: upload.chapterId,
          sourceStorageKey: upload.storageKey,
          storageProfileId: upload.storageProfileId,
          ...(input.requestId ? { requestId: input.requestId } : {}),
        };
      }
      if (!input.replacementId) return null;
      const [replacement] = await tx
        .select()
        .from(chapterReplacementOperations)
        .where(eq(chapterReplacementOperations.id, input.replacementId))
        .limit(1)
        .for("update");
      if (replacement?.status !== "validating") return null;
      const runId = await createOrResumeRun(tx, input);
      return {
        runId,
        chapterId: replacement.chapterId,
        sourceStorageKey: replacement.candidateZipStorageKey,
        storageProfileId: replacement.storageProfileId,
        ...(input.requestId ? { requestId: input.requestId } : {}),
      };
    });
  }

  async settle(
    runId: string,
    result: AdmissionValidationResult,
  ): Promise<void> {
    await this.db.transaction(async (tx) => {
      const [run] = await tx
        .select()
        .from(uploadValidationRuns)
        .where(eq(uploadValidationRuns.id, runId))
        .limit(1)
        .for("update");
      if (run?.status !== "validating") return;
      if (result.issues.length)
        await tx.insert(uploadValidationIssues).values(
          result.issues.slice(0, 1000).map((issue) => ({
            runId,
            code: issue.code,
            severity: issue.severity,
            ...(issue.fileIndex !== undefined
              ? { fileIndex: issue.fileIndex }
              : {}),
            ...(issue.filename
              ? { filename: issue.filename.slice(0, 255) }
              : {}),
            ...(issue.actual ? { actual: safeDetails(issue.actual) } : {}),
            ...(issue.expected
              ? { expected: safeDetails(issue.expected) }
              : {}),
          })),
        );
      if (result.outcome === "accepted") {
        if (result.manifest.length === 0)
          throw new Error("admission-empty-manifest");
        await tx.insert(uploadValidationEntries).values(
          result.manifest.map((entry) => ({
            runId,
            filename: entry.filename,
            extension: entry.extension,
            contentType: entry.contentType,
            sortOrder: entry.sortOrder,
            sizeBytes: entry.sizeBytes,
            checksumSha256: entry.checksumSha256,
            ...(entry.widthPx !== undefined ? { widthPx: entry.widthPx } : {}),
            ...(entry.heightPx !== undefined
              ? { heightPx: entry.heightPx }
              : {}),
            warnings: entry.warnings,
          })),
        );
        await this.accept(tx, run);
      } else {
        await this.reject(tx, run, result.issues);
      }
      await tx
        .update(uploadValidationRuns)
        .set({
          status: result.outcome === "accepted" ? "accepted" : "rejected",
          finishedAt: new Date(),
        })
        .where(eq(uploadValidationRuns.id, runId));
    });
  }

  async fail(
    runId: string,
    failure: {
      disposition: "retryable" | "retry_exhausted" | "terminal";
      code: string;
      providerCode?: string;
    },
  ): Promise<void> {
    await this.db.transaction(async (tx) => {
      const [run] = await tx
        .select()
        .from(uploadValidationRuns)
        .where(eq(uploadValidationRuns.id, runId))
        .limit(1)
        .for("update");
      if (run?.status !== "validating") return;
      const status =
        failure.disposition === "retryable"
          ? "retryable_failed"
          : failure.disposition === "retry_exhausted"
            ? "retry_exhausted"
            : "terminal_failed";
      await tx
        .update(uploadValidationRuns)
        .set({
          status,
          errorCode: failure.code.slice(0, 100),
          providerCode: failure.providerCode?.slice(0, 100) ?? null,
          finishedAt: new Date(),
        })
        .where(eq(uploadValidationRuns.id, runId));
      if (failure.disposition === "retryable") return;
      if (run.uploadId) {
        const [upload] = await tx
          .select({ chapterId: uploads.chapterId })
          .from(uploads)
          .where(eq(uploads.id, run.uploadId))
          .limit(1);
        if (!upload) throw new Error("admission-upload-missing");
        if (failure.disposition === "terminal") {
          const transition = await transitionChapterState(tx, {
            chapterId: upload.chapterId,
            transition: "fail-upload",
            expectedStates: ["uploading"],
          });
          if (!transition.transitioned)
            throw new Error("admission-chapter-transition-conflict");
        }
        await tx
          .update(uploads)
          .set({
            status:
              failure.disposition === "terminal"
                ? "terminal_failed"
                : "retry_exhausted",
            updatedAt: new Date(),
          })
          .where(
            and(eq(uploads.id, run.uploadId), eq(uploads.status, "validating")),
          );
        await tx
          .update(chapterImportItems)
          .set({
            status:
              failure.disposition === "terminal"
                ? "terminal_failed"
                : "retry_exhausted",
            errorCode: failure.code.slice(0, 100),
            updatedAt: new Date(),
          })
          .where(eq(chapterImportItems.uploadId, run.uploadId));
      } else if (run.replacementId) {
        await tx
          .update(chapterReplacementOperations)
          .set({
            status:
              failure.disposition === "terminal"
                ? "terminal_failed"
                : "retry_exhausted",
            lastErrorCode: failure.code.slice(0, 100),
            updatedAt: new Date(),
          })
          .where(
            and(
              eq(chapterReplacementOperations.id, run.replacementId),
              eq(chapterReplacementOperations.status, "validating"),
            ),
          );
      }
    });
  }

  private async accept(
    tx: Parameters<Parameters<NodeProxDatabase["transaction"]>[0]>[0],
    run: typeof uploadValidationRuns.$inferSelect,
  ) {
    if (run.uploadId) {
      const [upload] = await tx
        .select()
        .from(uploads)
        .where(eq(uploads.id, run.uploadId))
        .limit(1)
        .for("update");
      if (upload?.status !== "validating")
        throw new Error("admission-upload-transition-conflict");
      const transition = await transitionChapterState(tx, {
        chapterId: upload.chapterId,
        transition: "complete-upload",
        expectedStates: ["uploading"],
      });
      if (!transition.transitioned)
        throw new Error("admission-chapter-transition-conflict");
      const [chapter] = await tx
        .select({ seriesId: chapters.seriesId })
        .from(chapters)
        .where(eq(chapters.id, upload.chapterId))
        .limit(1);
      if (!chapter) throw new Error("admission-chapter-missing");
      await tx
        .update(uploads)
        .set({ status: "uploaded", updatedAt: new Date() })
        .where(eq(uploads.id, run.uploadId));
      await tx
        .update(chapterImportItems)
        .set({ status: "uploaded", errorCode: null, updatedAt: new Date() })
        .where(eq(chapterImportItems.uploadId, run.uploadId));
      await tx.insert(processingOutbox).values({
        uploadId: run.uploadId,
        chapterId: upload.chapterId,
        seriesId: chapter.seriesId,
        storageKey: upload.storageKey,
        storageProfileId: upload.storageProfileId,
        ...(run.requestId ? { originRequestId: run.requestId } : {}),
      });
    } else if (run.replacementId) {
      const [replacement] = await tx
        .update(chapterReplacementOperations)
        .set({ status: "uploaded", lastErrorCode: null, updatedAt: new Date() })
        .where(
          and(
            eq(chapterReplacementOperations.id, run.replacementId),
            eq(chapterReplacementOperations.status, "validating"),
          ),
        )
        .returning();
      if (!replacement)
        throw new Error("admission-replacement-transition-conflict");
      await tx.insert(chapterReplacementProcessingOutbox).values({
        replacementId: replacement.id,
        chapterId: replacement.chapterId,
        ...(run.requestId ? { originRequestId: run.requestId } : {}),
      });
    }
  }

  private async reject(
    tx: Parameters<Parameters<NodeProxDatabase["transaction"]>[0]>[0],
    run: typeof uploadValidationRuns.$inferSelect,
    issues: readonly ValidationIssue[],
  ) {
    const errorCode =
      issues.find((issue) => issue.severity === "error")?.code ?? "ZIP_INVALID";
    if (run.uploadId) {
      const [upload] = await tx
        .select({ chapterId: uploads.chapterId })
        .from(uploads)
        .where(eq(uploads.id, run.uploadId))
        .limit(1)
        .for("update");
      if (!upload) throw new Error("admission-upload-missing");
      const transition = await transitionChapterState(tx, {
        chapterId: upload.chapterId,
        transition: "reject-upload",
        expectedStates: ["uploading"],
      });
      if (!transition.transitioned)
        throw new Error("admission-chapter-transition-conflict");
      await tx
        .update(uploads)
        .set({ status: "rejected", updatedAt: new Date() })
        .where(
          and(eq(uploads.id, run.uploadId), eq(uploads.status, "validating")),
        );
      await tx
        .update(chapterImportItems)
        .set({ status: "rejected", errorCode, updatedAt: new Date() })
        .where(eq(chapterImportItems.uploadId, run.uploadId));
    } else if (run.replacementId) {
      await tx
        .update(chapterReplacementOperations)
        .set({
          status: "rejected",
          lastErrorCode: errorCode,
          updatedAt: new Date(),
        })
        .where(
          and(
            eq(chapterReplacementOperations.id, run.replacementId),
            eq(chapterReplacementOperations.status, "validating"),
          ),
        );
    }
  }
}

type Tx = Parameters<Parameters<NodeProxDatabase["transaction"]>[0]>[0];

async function createOrResumeRun(
  tx: Tx,
  input: AdmissionOwner & {
    jobId: string;
    jobAttempt: number;
    requestId?: string;
  },
): Promise<string> {
  if (!input.uploadId && !input.replacementId)
    throw new Error("admission-owner-missing");
  const owner = input.uploadId
    ? eq(uploadValidationRuns.uploadId, input.uploadId)
    : eq(uploadValidationRuns.replacementId, input.replacementId as string);
  const [existing] = await tx
    .select()
    .from(uploadValidationRuns)
    .where(
      and(
        owner,
        eq(uploadValidationRuns.jobId, input.jobId),
        eq(uploadValidationRuns.jobAttempt, input.jobAttempt),
      ),
    )
    .limit(1);
  if (existing) return existing.id;
  const [sequence] = await tx
    .select({
      next: sql<number>`coalesce(max(${uploadValidationRuns.attemptNumber}), 0) + 1`.mapWith(
        Number,
      ),
    })
    .from(uploadValidationRuns)
    .where(owner);
  const [run] = await tx
    .insert(uploadValidationRuns)
    .values({
      ...(input.uploadId
        ? { uploadId: input.uploadId }
        : { replacementId: input.replacementId }),
      attemptNumber: sequence?.next ?? 1,
      jobId: input.jobId,
      jobAttempt: input.jobAttempt,
      ...(input.requestId ? { requestId: input.requestId } : {}),
    })
    .returning({ id: uploadValidationRuns.id });
  if (!run) throw new Error("admission-run-create-failed");
  return run.id;
}

function safeDetails(
  details: Record<string, unknown>,
): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(details)
      .slice(0, 8)
      .filter(
        ([key, value]) =>
          /^[a-zA-Z][a-zA-Z0-9]{0,39}$/.test(key) &&
          (typeof value === "number" || typeof value === "boolean"),
      ),
  );
}
