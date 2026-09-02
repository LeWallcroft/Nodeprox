import type { ProcessChapterInput } from "@nodeprox/types";
import type { StoragePort } from "@nodeprox/storage/port";
import { buildPermanentImageStorageKey } from "../domain/image-policy.js";
import type {
  ProcessingAuditPort,
  ProcessingRepositoryPort,
  ZipExtractorPort,
} from "./ports.js";
export class ChapterProcessingService {
  constructor(
    private readonly repository: ProcessingRepositoryPort,
    private readonly storage: StoragePort,
    private readonly extractor: ZipExtractorPort,
    private readonly audit: ProcessingAuditPort,
  ) {}
  async process(
    input: ProcessChapterInput,
    removeSourceOnFailure = false,
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
    if (upload.chapterStatus === "ready") {
      await this.storage.delete(input.sourceStorageKey);
      return;
    }
    if (!(await this.repository.claimChapter(input.chapterId, input.uploadId)))
      return;
    const createdKeys: string[] = [];
    let published = false;
    try {
      const source = await this.storage.get(input.sourceStorageKey);
      const images = await this.extractor.inspect(source);
      const records = [];
      for (const image of images) {
        const storageKey = buildPermanentImageStorageKey({
          seriesPublicSlug: upload.seriesPublicSlug,
          chapterPublicKey: upload.chapterPublicKey,
          filename: image.filename,
        });
        const stored = await this.storage.put({
          key: storageKey,
          body: this.extractor.readImage(image),
          contentType: image.contentType,
          sizeBytes: image.sizeBytes,
        });
        if (
          stored.key !== storageKey ||
          stored.sizeBytes !== image.sizeBytes ||
          stored.sizeBytes <= 0 ||
          stored.contentType !== image.contentType
        )
          throw new Error("stored-image-metadata-mismatch");
        createdKeys.push(stored.key);
        records.push({ ...image, storageKey: stored.key });
      }
      await this.repository.replaceImagesAndMarkReady(
        input.chapterId,
        input.uploadId,
        records,
      );
      published = true;
      await this.storage.delete(input.sourceStorageKey);
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
    } catch (error) {
      if (published) throw error;
      await this.repository
        .deleteImages(input.chapterId)
        .catch(() => undefined);
      await Promise.all(
        createdKeys.map((key) =>
          this.storage.delete(key).catch(() => undefined),
        ),
      );
      if (removeSourceOnFailure)
        await this.storage
          .delete(input.sourceStorageKey)
          .catch(() => undefined);
      await this.repository
        .markFailed(input.chapterId, input.uploadId, removeSourceOnFailure)
        .catch(() => undefined);
      await this.audit
        .append({
          actorId: upload.createdBy,
          action: "chapter.processing.failed",
          resourceType: "chapter",
          resourceId: input.chapterId,
          result: "failed",
          reasonCode: "processing-failed",
          ...(input.originRequestId
            ? { requestId: input.originRequestId }
            : {}),
          metadata: { result: "failed" },
        })
        .catch(() => undefined);
      throw error;
    } finally {
      await this.extractor.dispose().catch(() => undefined);
    }
  }
}
