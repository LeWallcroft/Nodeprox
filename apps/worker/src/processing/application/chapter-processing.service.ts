import type { StorageExecutionResolver } from "@nodeprox/storage/profile-execution";
import type { ProcessChapterInput } from "@nodeprox/types";
import type { ValidatedChapterManifest } from "../../admission-validation/domain/admission-validation.types.js";
import { measureStage } from "../../observability/application/measure-stage.js";
import type { PerformanceObserverPort } from "../../observability/application/performance-observer.port.js";
import type { ValidatedImage } from "../domain/image-policy.js";
import { buildPermanentImageStorageKey } from "../domain/image-policy.js";
import type {
  ImageRecordInput,
  ProcessingAuditPort,
  ProcessingRepositoryPort,
  ZipExtractorPort,
} from "./ports.js";
import { classifyProcessingError } from "./processing-error.classifier.js";
import { ProcessingPermanentFailure } from "./processing.errors.js";
export { ProcessingPermanentFailure } from "./processing.errors.js";
import { putIfAbsentOrVerifyEquivalent } from "./put-if-absent-or-verify-equivalent.js";
export class ChapterProcessingService {
  constructor(
    private readonly repository: ProcessingRepositoryPort,
    private readonly storageExecution: StorageExecutionResolver,
    private readonly extractor: ZipExtractorPort,
    private readonly audit: ProcessingAuditPort,
    private readonly logger?: { error(context: object, message: string): void },
    private readonly observer?: PerformanceObserverPort,
  ) {}
  async process(
    input: ProcessChapterInput,
    finalAttempt = false,
    invocation?: { jobId: string; jobAttempt: number },
  ): Promise<void> {
    const preflight = await measureStage(
      this.observer,
      "processing.preflight",
      async () => {
        const upload = await this.repository.findUpload(input.uploadId);
        if (
          !upload ||
          upload.chapterId !== input.chapterId ||
          upload.seriesId !== input.seriesId ||
          upload.storageKey !== input.sourceStorageKey ||
          upload.status !== "uploaded"
        )
          return null;
        const storage = await this.storageExecution.storageFor(
          upload.storageProfileId,
        );
        if (upload.chapterStatus === "ready") return null;
        return { upload, storage };
      },
    );
    if (!preflight) return;
    const { upload, storage } = preflight;
    const claim = await measureStage(this.observer, "processing.claim", () =>
      this.repository.claimChapter({
        chapterId: input.chapterId,
        uploadId: input.uploadId,
        ...(invocation?.jobId ? { jobId: invocation.jobId } : {}),
        ...(invocation?.jobAttempt
          ? { jobAttempt: invocation.jobAttempt }
          : {}),
      }),
    );
    if (!("attempt" in claim) || claim.outcome === "finished") return;
    const attempt = claim.attempt;
    const createdKeys: string[] = [];
    try {
      const images = await measureStage(
        this.observer,
        "processing.zip.fetch_extract",
        async () => {
          const source = await storage.get(input.sourceStorageKey);
          return this.extractor.inspect(source);
        },
      );
      await measureStage(
        this.observer,
        "processing.manifest_match",
        async () => {
          const manifest = await this.repository.loadLatestAcceptedManifest(
            input.uploadId,
          );
          if (!manifestMatches(manifest, images))
            throw new ProcessingPermanentFailure(
              "VALIDATION_MANIFEST_MISMATCH",
            );
        },
      );
      const records: ImageRecordInput[] = [];
      for (const image of images) {
        const storageKey = buildPermanentImageStorageKey({
          seriesPublicSlug: upload.seriesPublicSlug,
          chapterPublicKey: upload.chapterPublicKey,
          filename: image.filename,
        });
        await measureStage(this.observer, "processing.image.reserve", () =>
          this.repository.reserveCandidate(
            attempt.id,
            storageKey,
            image.checksum,
          ),
        );
        let writeOutcome:
          | "created"
          | "existing-equivalent"
          | "existing-conflict"
          | undefined;
        const write = await measureStage(
          this.observer,
          "processing.image.persist_verify",
          async () => {
            const result = await putIfAbsentOrVerifyEquivalent({
              storage,
              key: storageKey,
              body: this.extractor.replayableImage(image),
              contentType: image.contentType,
              sizeBytes: image.sizeBytes,
              checksum: image.checksum,
              ...(this.observer ? { observer: this.observer } : {}),
              onCreated: async () => {
                createdKeys.push(storageKey);
                await this.repository.markCandidate(
                  attempt.id,
                  storageKey,
                  "created",
                );
              },
            });
            writeOutcome = result.outcome;
            if (result.outcome === "existing-conflict")
              throw new Error("storage-key-content-conflict");
            if (result.outcome === "existing-equivalent")
              await this.repository.markCandidate(
                attempt.id,
                storageKey,
                "reused",
              );
            return result;
          },
          () => ({
            bytes:
              writeOutcome && writeOutcome !== "existing-conflict"
                ? image.sizeBytes
                : 0,
            ...(writeOutcome ? { objectOutcome: writeOutcome } : {}),
          }),
        );
        records.push({
          ...image,
          storageKey: write.key,
          storageProfileId: upload.storageProfileId,
        });
      }
      await measureStage(this.observer, "processing.db_finalize", () =>
        this.repository.replaceImagesAndMarkReady(
          input.chapterId,
          input.uploadId,
          attempt.id,
          upload.createdBy,
          records,
        ),
      );
      await measureStage(this.observer, "processing.audit", () =>
        this.audit
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
          }),
      );
    } catch (error) {
      const classification = classifyProcessingError(error);
      const disposition = !classification.retryable
        ? "terminal"
        : finalAttempt
          ? "retry_exhausted"
          : "retryable";
      await measureStage(this.observer, "processing.cleanup", async () => {
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
                    cleanupError instanceof Error
                      ? cleanupError.name
                      : "unknown",
                },
                "Candidate cleanup deferred to reconciliation",
              );
            }
          }),
        );
      });
      await measureStage(this.observer, "processing.audit", () =>
        this.audit
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
          }),
      );
      if (disposition === "terminal")
        throw new ProcessingPermanentFailure(classification.code);
      throw error;
    } finally {
      await measureStage(this.observer, "processing.cleanup", () =>
        this.extractor.dispose().catch((error: unknown) => {
          this.logger?.error(
            {
              event: "processing-temp-cleanup-failed",
              attemptId: attempt.id,
              errorName: error instanceof Error ? error.name : "unknown",
            },
            "Processing temporary cleanup failed",
          );
        }),
      );
    }
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
