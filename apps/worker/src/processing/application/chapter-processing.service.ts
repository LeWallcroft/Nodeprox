import type { ProcessChapterInput } from "@nodeprox/types";
import type { StoragePort } from "@nodeprox/storage/port";
import { permanentImageKey } from "../domain/image-policy.js";
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
    if (!(await this.repository.claimChapter(input.chapterId))) return;
    const createdKeys: string[] = [];
    try {
      const images = await this.extractor.inspect(
        await this.storage.get(input.sourceStorageKey),
      );
      const records = [];
      for (const image of images) {
        const storageKey = permanentImageKey(
          input.seriesId,
          input.chapterId,
          image.filename,
        );
        await this.storage.put({
          key: storageKey,
          body: this.extractor.readImage(image),
          contentType: image.contentType,
          sizeBytes: image.sizeBytes,
        });
        createdKeys.push(storageKey);
        records.push({ ...image, storageKey });
      }
      await this.repository.replaceImagesAndMarkReady(input.chapterId, records);
      await this.storage.delete(input.sourceStorageKey);
      await this.audit.append({
        actorId: upload.createdBy,
        action: "chapter.processing.completed",
        resourceType: "chapter",
        resourceId: input.chapterId,
        metadata: { imageCount: records.length },
      });
    } catch (error) {
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
      await this.repository.markFailed(input.chapterId).catch(() => undefined);
      await this.audit
        .append({
          actorId: upload.createdBy,
          action: "chapter.processing.failed",
          resourceType: "chapter",
          resourceId: input.chapterId,
          metadata: { result: "failed" },
        })
        .catch(() => undefined);
      throw error;
    } finally {
      await this.extractor.dispose().catch(() => undefined);
    }
  }
}
