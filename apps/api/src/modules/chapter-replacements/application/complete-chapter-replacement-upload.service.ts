import {
  UploadTransferObjectNotFoundError,
  type UploadTransferPort,
  UploadTransferProviderError,
  type VerifiedUploadedObject,
} from "@nodeprox/storage/port";
import type { AuthorizationContext } from "../../authorization/domain/authorization.types.js";
import type { ChapterImageAuthorizationPort } from "../../images/application/ports.js";
import type { ChapterReplacementResult } from "../domain/chapter-replacement-result.js";
import type { ChapterReplacementStatus } from "../domain/chapter-replacement-status.js";
import type { ChapterReplacementUploadRepository } from "./ports/chapter-replacement-upload.repository.js";

export class ChapterReplacementUploadNotFoundError extends Error {}
export class ChapterReplacementUploadDeniedError extends Error {}
export class ChapterReplacementUploadInvalidError extends Error {}
export class ChapterReplacementUploadFailedError extends Error {}
export class ChapterReplacementUploadProviderError extends Error {}
export class ChapterReplacementUploadInvariantError extends Error {}

export type ChapterReplacementUploadResult =
  | ChapterReplacementResult
  | {
      replacementId: string;
      chapterId: string;
      status: Exclude<ChapterReplacementStatus, "completed">;
    };

export class CompleteChapterReplacementUploadService {
  constructor(
    private readonly repository: ChapterReplacementUploadRepository,
    private readonly transfer: UploadTransferPort,
    private readonly authorization: ChapterImageAuthorizationPort,
  ) {}

  async execute(input: {
    context: AuthorizationContext;
    replacementId: string;
    chapterId: string;
    originRequestId?: string;
  }): Promise<ChapterReplacementUploadResult> {
    let operation = await this.repository.findByIdForChapter(
      input.replacementId,
      input.chapterId,
    );
    if (!operation) throw new ChapterReplacementUploadNotFoundError();
    const decision = await this.authorization.check({
      context: input.context,
      chapterId: operation.chapterId,
      permission: "chapters.replace",
    });
    if (decision.reason === "not-found")
      throw new ChapterReplacementUploadNotFoundError();
    if (!decision.allowed) throw new ChapterReplacementUploadDeniedError();

    if (operation.status === "completed") return this.completed(operation.id);
    if (operation.status === "failed")
      throw new ChapterReplacementUploadFailedError();
    if (operation.status !== "pending_upload") return stateOf(operation);

    let verified: VerifiedUploadedObject;
    try {
      verified = await this.transfer.verify({
        key: operation.candidateZipStorageKey,
      });
    } catch (error) {
      if (error instanceof UploadTransferObjectNotFoundError)
        throw new ChapterReplacementUploadNotFoundError();
      if (error instanceof UploadTransferProviderError)
        throw new ChapterReplacementUploadProviderError();
      throw error;
    }
    if (
      verified.key !== operation.candidateZipStorageKey ||
      verified.sizeBytes !== operation.sizeBytes ||
      (verified.contentType !== undefined &&
        normalizeContentType(verified.contentType) !==
          normalizeContentType(operation.contentType))
    )
      throw new ChapterReplacementUploadInvalidError();

    operation = await this.repository.markUploadedAndEnqueue({
      replacementId: operation.id,
      chapterId: operation.chapterId,
      ...(input.originRequestId
        ? { originRequestId: input.originRequestId }
        : {}),
      ...(verified.etag ? { etag: verified.etag } : {}),
    });
    if (!operation) throw new ChapterReplacementUploadNotFoundError();
    if (operation.status === "completed") return this.completed(operation.id);
    if (operation.status === "failed")
      throw new ChapterReplacementUploadFailedError();
    return stateOf(operation);
  }

  private async completed(replacementId: string) {
    const result = await this.repository.getCompletedResult(replacementId);
    if (!result) throw new ChapterReplacementUploadInvariantError();
    return result;
  }
}

function stateOf(operation: {
  id: string;
  chapterId: string;
  status: ChapterReplacementStatus;
}) {
  if (operation.status === "completed")
    throw new ChapterReplacementUploadInvariantError();
  return {
    replacementId: operation.id,
    chapterId: operation.chapterId,
    status: operation.status,
  };
}

function normalizeContentType(value: string): string {
  return value.split(";", 1)[0]?.trim().toLowerCase() ?? "";
}
