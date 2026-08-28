import { randomUUID } from "node:crypto";
import type { AuthorizationContext } from "../../authorization/domain/authorization.types.js";
import type {
  ImportBatchRepositoryPort,
  ImportChapterPort,
  ImportItemInput,
  ImportSeriesAccessPort,
  ImportUploadPort,
} from "./ports.js";

export class ChapterImportBatchService {
  constructor(
    private readonly repository: ImportBatchRepositoryPort,
    private readonly access: ImportSeriesAccessPort,
    private readonly chapters: ImportChapterPort,
    private readonly uploads: ImportUploadPort,
  ) {}

  async create(input: {
    actor: AuthorizationContext;
    seriesId: string;
    items: readonly ImportItemInput[];
  }) {
    const access = await this.access.check(input.actor, input.seriesId);
    if (access === "denied") throw new ImportBatchDeniedError();
    if (access === "not-found") throw new ImportBatchNotFoundError();
    const batchId = randomUUID();
    await this.repository.create({
      id: batchId,
      seriesId: input.seriesId,
      createdBy: input.actor.userId,
    });

    const items = [];
    for (const candidate of input.items) {
      const chapter = await this.chapters.create({
        actor: input.actor,
        seriesId: input.seriesId,
        chapterNumber: candidate.chapterNumber,
      });
      if (chapter.outcome !== "created") {
        const errorCode = `chapter-${chapter.outcome}`;
        const itemId = await this.repository.addItem({
          batchId,
          clientId: candidate.clientId,
          chapterNumber: candidate.chapterNumber,
          filename: candidate.filename,
          status: "failed",
          errorCode,
        });
        items.push({
          itemId,
          clientId: candidate.clientId,
          chapterNumber: candidate.chapterNumber,
          status: "failed" as const,
          errorCode,
        });
        continue;
      }
      try {
        const upload = await this.uploads.initiate({
          actor: input.actor,
          chapterId: chapter.chapterId,
          filename: candidate.filename,
          contentType: candidate.contentType,
          sizeBytes: candidate.sizeBytes,
        });
        const itemId = await this.repository.addItem({
          batchId,
          clientId: candidate.clientId,
          chapterNumber: candidate.chapterNumber,
          filename: candidate.filename,
          chapterId: chapter.chapterId,
          uploadId: upload.uploadId,
          status: "uploading",
        });
        items.push({
          itemId,
          clientId: candidate.clientId,
          chapterNumber: candidate.chapterNumber,
          chapterId: chapter.chapterId,
          uploadId: upload.uploadId,
          status: "uploading" as const,
          transfer: upload.transfer,
        });
      } catch (error) {
        const errorCode = safeImportErrorCode(error);
        const itemId = await this.repository.addItem({
          batchId,
          clientId: candidate.clientId,
          chapterNumber: candidate.chapterNumber,
          filename: candidate.filename,
          chapterId: chapter.chapterId,
          status: "failed",
          errorCode,
        });
        items.push({
          itemId,
          clientId: candidate.clientId,
          chapterNumber: candidate.chapterNumber,
          chapterId: chapter.chapterId,
          status: "failed" as const,
          errorCode,
        });
      }
    }
    return { batchId, status: projectBatchStatus(items), items };
  }

  async get(actor: AuthorizationContext, batchId: string) {
    const batch = await this.repository.find(batchId);
    if (!batch) throw new ImportBatchNotFoundError();
    const access = await this.access.check(actor, batch.seriesId);
    if (access === "denied") throw new ImportBatchDeniedError();
    if (access === "not-found") throw new ImportBatchNotFoundError();
    return {
      batchId: batch.id,
      status: projectBatchStatus(batch.items),
      items: batch.items,
    };
  }

  async retry(input: {
    actor: AuthorizationContext;
    seriesId: string;
    batchId: string;
    itemId: string;
    contentType: string;
    sizeBytes: number;
  }) {
    const access = await this.access.check(input.actor, input.seriesId);
    if (access === "denied") throw new ImportBatchDeniedError();
    if (access === "not-found") throw new ImportBatchNotFoundError();
    const claim = await this.repository.claimRetry(input);
    if (claim.outcome === "not-found") throw new ImportBatchNotFoundError();
    if (claim.outcome === "conflict") throw new ImportBatchConflictError();
    if (claim.outcome !== "claimed") throw new ImportBatchConflictError();
    const item = claim.item;
    try {
      const upload = await this.uploads.initiate({
        actor: input.actor,
        chapterId: item.chapterId,
        filename: item.filename,
        contentType: input.contentType,
        sizeBytes: input.sizeBytes,
      });
      if (
        !(await this.repository.attachRetryUpload({
          itemId: item.id,
          uploadId: upload.uploadId,
        }))
      ) {
        await this.uploads
          .abort({
            actor: input.actor,
            chapterId: item.chapterId,
            uploadId: upload.uploadId,
          })
          .catch(() => undefined);
        throw new ImportBatchConflictError();
      }
      return {
        itemId: item.id,
        clientId: item.clientId,
        chapterId: item.chapterId,
        uploadId: upload.uploadId,
        status: "uploading" as const,
        transfer: upload.transfer,
      };
    } catch (error) {
      await this.repository
        .failRetry({
          itemId: item.id,
          errorCode: safeImportErrorCode(error),
        })
        .catch(() => undefined);
      throw error;
    }
  }
}

function safeImportErrorCode(error: unknown): string {
  if (error instanceof Error && error.name)
    return error.name
      .replace(/Error$/, "")
      .replace(/([a-z])([A-Z])/g, "$1-$2")
      .toLowerCase();
  return "upload-initiation-failed";
}

function projectBatchStatus(
  items: readonly { status: string }[],
): "pending" | "running" | "completed" | "completed_with_errors" {
  if (items.every((item) => item.status === "ready")) return "completed";
  const final = items.every(
    (item) => item.status === "ready" || item.status === "failed",
  );
  if (final) return "completed_with_errors";
  if (items.every((item) => item.status === "pending")) return "pending";
  return "running";
}

export class ImportBatchDeniedError extends Error {}
export class ImportBatchNotFoundError extends Error {}
export class ImportBatchConflictError extends Error {}
