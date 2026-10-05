import type { StorageExecutionResolver } from "@nodeprox/storage/profile-execution";
import type { ProcessChapterInput } from "@nodeprox/types";
import type { ValidatedChapterManifest } from "../../admission-validation/domain/admission-validation.types.js";
import type { ValidatedImage } from "../domain/image-policy.js";
import { buildPermanentImageStorageKey } from "../domain/image-policy.js";
import type {
  ProcessingAuditPort,
  ProcessingRepositoryPort,
  ZipExtractorPort,
} from "./ports.js";
import { classifyProcessingError } from "./processing-error.classifier.js";
import { putIfAbsentOrVerifyEquivalent } from "./put-if-absent-or-verify-equivalent.js";
export class ChapterProcessingService {
  constructor(
    private readonly repository: ProcessingRepositoryPort,
    private readonly storageExecution: StorageExecutionResolver,
    private readonly extractor: ZipExtractorPort,
    private readonly audit: ProcessingAuditPort,
    private readonly logger?: { error(context: object, message: string): void },
  ) {}
  async process(
    input: ProcessChapterInput,
    finalAttempt = false,
    invocation?: { jobId: string; jobAttempt: number },
  ): Promise<void> {
    const upload = await this.repository.findUpload(input.uploadId);
    if (
      !upload ||
      upload.chapterId !== input.chapterId ||
      upload.seriesId !== input.seriesId ||
      upload.storageKey !== input.sourceStorageKey ||
      upload.status !== "uploaded"
    )
      return;
    const storage = await this.storageExecution.storageFor(
      upload.storageProfileId,
    );
    if (upload.chapterStatus === "ready") {
      return;
    }
    const claim = await this.repository.claimChapter({
      chapterId: input.chapterId,
      uploadId: input.uploadId,
      ...(invocation?.jobId ? { jobId: invocation.jobId } : {}),
      ...(invocation?.jobAttempt ? { jobAttempt: invocation.jobAttempt } : {}),
    });
    if (!("attempt" in claim) || claim.outcome === "finished") return;
    const attempt = claim.attempt;
    const createdKeys: string[] = [];
    try {
      const source = await storage.get(input.sourceStorageKey);
      const images = await this.extractor.inspect(source);
      const manifest = await this.repository.loadLatestAcceptedManifest(
        input.uploadId,
      );
      if (!manifestMatches(manifest, images))
        throw new ProcessingPermanentFailure("VALIDATION_MANIFEST_MISMATCH");
      const records = [];
      for (const image of images) {
        const storageKey = buildPermanentImageStorageKey({
          seriesPublicSlug: upload.seriesPublicSlug,
          chapterPublicKey: upload.chapterPublicKey,
          filename: image.filename,
        });
        await this.repository.reserveCandidate(
          attempt.id,
          storageKey,
          image.checksum,
        );
        const write = await putIfAbsentOrVerifyEquivalent({
          storage,
          key: storageKey,
          body: this.extractor.replayableImage(image),
          contentType: image.contentType,
          sizeBytes: image.sizeBytes,
          checksum: image.checksum,
          onCreated: async () => {
            createdKeys.push(storageKey);
            await this.repository.markCandidate(
              attempt.id,
              storageKey,
              "created",
            );
          },
        });
        if (write.outcome === "existing-conflict")
          throw new Error("storage-key-content-conflict");
        if (write.outcome === "existing-equivalent")
          await this.repository.markCandidate(attempt.id, storageKey, "reused");
        records.push({
          ...image,
          storageKey: write.key,
          storageProfileId: upload.storageProfileId,
        });
      }
      await this.repository.replaceImagesAndMarkReady(
        input.chapterId,
        input.uploadId,
        attempt.id,
        upload.createdBy,
        records,
      );
      await this.audit
        .append({
          actorId: upload.createdBy,
          action: "chapter.processing.completed",
          resourceType: "chapter",
          resourceId: input.chapterId,
          result: "success",
          ...(input.originRequestId
            ? { requestId: input.originRequestId }
            : {}),
          metadata: {
            imageCount: records.length,
          },
        })
        .catch((error: unknown) => {
          this.logger?.error(
            {
              event: "processing-audit-failed",
              attemptId: attempt.id,
              errorName: error instanceof Error ? error.name : "unknown",
            },
            "Processing completion audit failed",
          );
        });
    } catch (error) {
      const classification = classifyProcessingError(error);
      const disposition = !classification.retryable
        ? "terminal"
        : finalAttempt
          ? "retry_exhausted"
          : "retryable";
      await this.repository.markFailed(
        input.chapterId,
        input.uploadId,
        attempt.id,
        {
          disposition,
          errorCode: classification.code,
          errorMessage: classification.message,
        },
        upload.createdBy,
      );
      await Promise.all(
        createdKeys.map(async (key) => {
          try {
            await storage.delete(key);
            await this.repository.markCandidate(attempt.id, key, "cleaned");
          } catch (cleanupError) {
            this.logger?.error(
              {
                event: "processing-candidate-cleanup-failed",
                attemptId: attempt.id,
                errorName:
                  cleanupError instanceof Error ? cleanupError.name : "unknown",
              },
              "Candidate cleanup deferred to reconciliation",
            );
          }
        }),
      );
      await this.audit
        .append({
          actorId: upload.createdBy,
          action: "chapter.processing.failed",
          resourceType: "chapter",
          resourceId: input.chapterId,
          result: "failed",
          reasonCode: classification.code,
          ...(input.originRequestId
            ? { requestId: input.originRequestId }
            : {}),
          metadata: {
            result: "failed",
            attemptId: attempt.id,
            attemptNumber: attempt.attemptNumber,
            disposition,
          },
        })
        .catch((auditError: unknown) => {
          this.logger?.error(
            {
              event: "processing-audit-failed",
              attemptId: attempt.id,
              errorName:
                auditError instanceof Error ? auditError.name : "unknown",
            },
            "Processing failure audit failed",
          );
        });
      if (disposition === "terminal")
        throw new ProcessingPermanentFailure(classification.code);
      throw error;
    } finally {
      await this.extractor.dispose().catch((error: unknown) => {
        this.logger?.error(
          {
            event: "processing-temp-cleanup-failed",
            attemptId: attempt.id,
            errorName: error instanceof Error ? error.name : "unknown",
          },
          "Processing temporary cleanup failed",
        );
      });
    }
  }
}

export class ProcessingPermanentFailure extends Error {
  constructor(readonly code: string) {
    super(code);
  }
}

function manifestMatches(
  manifest: ValidatedChapterManifest | null,
  images: readonly ValidatedImage[],
): boolean {
  if (!manifest || manifest.length !== images.length) return false;
  const byOrder = new Map(manifest.map((entry) => [entry.sortOrder, entry]));
  return images.every((image) => {
    const entry = byOrder.get(image.sortOrder);
    return (
      entry?.filename === image.filename &&
      entry.sortOrder === image.sortOrder &&
      entry.sizeBytes === image.sizeBytes &&
      entry.checksumSha256 === image.checksum &&
      entry.contentType === image.contentType
    );
  });
}
