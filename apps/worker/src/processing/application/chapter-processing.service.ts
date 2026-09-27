import type { StorageExecutionResolver } from "@nodeprox/storage/profile-execution";
import type { ProcessChapterInput } from "@nodeprox/types";
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
  ) {}
  async process(
    input: ProcessChapterInput,
    removeSourceOnFailure = false,
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
      await storage.delete(input.sourceStorageKey).catch(() => undefined);
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
          body: this.extractor.readImage(image),
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
        .catch(() => undefined);

      await storage.delete(input.sourceStorageKey).catch(async () => {
        await this.audit
          .append({
            actorId: upload.createdBy,
            action: "chapter.processing.source-cleanup.failed",
            resourceType: "chapter",
            resourceId: input.chapterId,
            result: "failed",
            reasonCode: "source-cleanup-failed",
            ...(input.originRequestId
              ? { requestId: input.originRequestId }
              : {}),
            metadata: { uploadId: input.uploadId, attemptId: attempt.id },
          })
          .catch(() => undefined);
      });
    } catch (error) {
      const classification = classifyProcessingError(error);
      const terminal = !classification.retryable || removeSourceOnFailure;
      await this.repository.markFailed(
        input.chapterId,
        input.uploadId,
        attempt.id,
        {
          terminal,
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
          } catch {
            // The durable cleanup_pending row is handled by reconciliation.
          }
        }),
      );
      if (terminal)
        await storage.delete(input.sourceStorageKey).catch(() => undefined);
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
            retryable: !terminal,
          },
        })
        .catch(() => undefined);
      throw error;
    } finally {
      await this.extractor.dispose().catch(() => undefined);
    }
  }
}
