import { randomUUID } from "node:crypto";
import type { AuthorizationContext } from "../../authorization/domain/authorization.types.js";
import {
  ChapterTargetDeniedError,
  ChapterTargetNotFoundError,
  type ChapterTargetResolver,
} from "./chapter-target.resolver.js";
import type {
  ImportBatchRepositoryPort,
  ImportItemInput,
  ImportSeriesAccessPort,
  ImportUploadPort,
} from "./ports.js";

export class ChapterImportBatchService {
  constructor(
    private readonly repository: ImportBatchRepositoryPort,
    private readonly access: ImportSeriesAccessPort,
    private readonly targets: ChapterTargetResolver,
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
      let target: Awaited<ReturnType<ChapterTargetResolver["resolve"]>>;
      try {
        target = await this.targets.resolve({
          actor: input.actor,
          seriesId: input.seriesId,
          chapterNumber: candidate.chapterNumber,
        });
      } catch (error) {
        if (error instanceof ChapterTargetDeniedError)
          throw new ImportBatchDeniedError();
        if (error instanceof ChapterTargetNotFoundError)
          throw new ImportBatchNotFoundError();
        throw error;
      }
      if (target.kind === "conflict") {
        const itemId = await this.repository.addItem({
          batchId,
          clientId: candidate.clientId,
          chapterNumber: candidate.chapterNumber,
          filename: candidate.filename,
          ...(target.chapterId ? { chapterId: target.chapterId } : {}),
          status: "failed",
          resolution: "conflict",
          errorCode: target.reason,
        });
        items.push({
          itemId,
          clientId: candidate.clientId,
          chapterNumber: candidate.chapterNumber,
          ...(target.chapterId ? { chapterId: target.chapterId } : {}),
          status: "failed" as const,
          resolution: "conflict" as const,
          errorCode: target.reason,
        });
        continue;
      }
      const itemId = await this.repository.addItem({
        batchId,
        clientId: candidate.clientId,
        chapterNumber: candidate.chapterNumber,
        filename: candidate.filename,
        chapterId: target.chapterId,
        status: "pending",
        resolution: target.kind,
      });
      try {
        const upload = await this.uploads.initiate({
          actor: input.actor,
          chapterId: target.chapterId,
          filename: candidate.filename,
          contentType: candidate.contentType,
          sizeBytes: candidate.sizeBytes,
        });
        if (upload.outcome === "conflict") {
          await this.repository.updateResolution({
            itemId,
            chapterId: target.chapterId,
            resolution: "conflict",
            status: "failed",
            errorCode: "chapter-upload-active",
          });
          items.push({
            itemId,
            clientId: candidate.clientId,
            chapterNumber: candidate.chapterNumber,
            chapterId: target.chapterId,
            status: "failed" as const,
            resolution: "conflict" as const,
            errorCode: "chapter-upload-active",
          });
          continue;
        }
        if (
          !(await this.repository.attachUpload({
            itemId,
            uploadId: upload.uploadId,
          }))
        ) {
          await this.uploads
            .abort({
              actor: input.actor,
              chapterId: target.chapterId,
              uploadId: upload.uploadId,
            })
            .catch(() => undefined);
          await this.repository.failItem({
            itemId,
            errorCode: "import-batch-item-conflict",
          });
          throw new ImportBatchConflictError();
        }
        items.push({
          itemId,
          clientId: candidate.clientId,
          chapterNumber: candidate.chapterNumber,
          chapterId: target.chapterId,
          uploadId: upload.uploadId,
          status: "uploading" as const,
          resolution: target.kind,
          transfer: upload.transfer,
        });
      } catch (error) {
        const errorCode = safeImportErrorCode(error);
        await this.repository.failItem({
          itemId,
          errorCode,
        });
        items.push({
          itemId,
          clientId: candidate.clientId,
          chapterNumber: candidate.chapterNumber,
          chapterId: target.chapterId,
          status: "failed" as const,
          resolution: target.kind,
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
    let target: Awaited<ReturnType<ChapterTargetResolver["resolve"]>>;
    try {
      target = await this.targets.resolve({
        actor: input.actor,
        seriesId: input.seriesId,
        chapterNumber: item.chapterNumber,
        retryChapterId: item.chapterId,
      });
      if (target.kind === "conflict") {
        await this.repository.updateResolution({
          itemId: item.id,
          ...(target.chapterId ? { chapterId: target.chapterId } : {}),
          resolution: "conflict",
          status: "failed",
          errorCode: target.reason,
        });
        throw new ImportBatchConflictError(target.reason);
      }
      await this.repository.updateResolution({
        itemId: item.id,
        chapterId: target.chapterId,
        resolution: target.kind,
        errorCode: null,
      });
      const upload = await this.uploads.initiate({
        actor: input.actor,
        chapterId: target.chapterId,
        filename: item.filename,
        contentType: input.contentType,
        sizeBytes: input.sizeBytes,
      });
      if (upload.outcome === "conflict") {
        await this.repository.updateResolution({
          itemId: item.id,
          chapterId: target.chapterId,
          resolution: "conflict",
          status: "failed",
          errorCode: "chapter-upload-active",
        });
        throw new ImportBatchConflictError("chapter-upload-active");
      }
      if (
        !(await this.repository.attachUpload({
          itemId: item.id,
          uploadId: upload.uploadId,
        }))
      ) {
        await this.uploads
          .abort({
            actor: input.actor,
            chapterId: target.chapterId,
            uploadId: upload.uploadId,
          })
          .catch(() => undefined);
        await this.repository.failItem({
          itemId: item.id,
          errorCode: "import-batch-item-conflict",
        });
        throw new ImportBatchConflictError();
      }
      return {
        itemId: item.id,
        clientId: item.clientId,
        chapterId: target.chapterId,
        uploadId: upload.uploadId,
        status: "uploading" as const,
        resolution: target.kind,
        transfer: upload.transfer,
      };
    } catch (error) {
      if (error instanceof ChapterTargetDeniedError) {
        await this.repository
          .failItem({ itemId: item.id, errorCode: "authorization-denied" })
          .catch(() => undefined);
        throw new ImportBatchDeniedError();
      }
      if (error instanceof ChapterTargetNotFoundError) {
        await this.repository
          .failItem({ itemId: item.id, errorCode: "resource-not-found" })
          .catch(() => undefined);
        throw new ImportBatchNotFoundError();
      }
      if (!(error instanceof ImportBatchConflictError))
        await this.repository
          .failItem({
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
export class ImportBatchConflictError extends Error {
  constructor(readonly reason = "import-batch-item-conflict") {
    super(reason);
  }
}
