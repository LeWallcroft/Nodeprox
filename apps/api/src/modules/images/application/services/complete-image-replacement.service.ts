import {
  UploadTransferObjectNotFoundError,
  type UploadTransferPort,
  UploadTransferProviderError,
} from "@nodeprox/storage/port";
import type { StorageExecutionResolver } from "@nodeprox/storage/profile-execution";
import type { AuthorizationContext } from "../../../authorization/domain/authorization.types.js";
import type { ImageReplacementOperationRepository } from "../image-replacement-operation.repository.js";
import type { ChapterImageAuthorizationPort } from "../ports.js";

export class ImageReplacementCompletionNotFoundError extends Error {}
export class ImageReplacementCompletionDeniedError extends Error {}
export class ImageReplacementCompletionInvalidError extends Error {}
export class ImageReplacementCompletionInProgressError extends Error {}
export class ImageReplacementCompletionFailedError extends Error {}
export class ImageReplacementCompletionInvariantError extends Error {}

export type QueuedImageReplacementResult = {
  replacementId: string;
  imageId: string;
  chapterId: string;
  status: "uploaded" | "completing" | "completed";
};

export class CompleteImageReplacementService {
  constructor(
    private readonly operations: ImageReplacementOperationRepository,
    private readonly storageExecution: StorageExecutionResolver,
    private readonly authorization: ChapterImageAuthorizationPort,
    private readonly now: () => Date = () => new Date(),
  ) {}

  async execute(input: {
    context: AuthorizationContext;
    chapterId: string;
    imageId: string;
    replacementId: string;
    requestId?: string;
  }): Promise<QueuedImageReplacementResult> {
    let operation = await this.operations.findById(input.replacementId);
    if (!operation) throw new ImageReplacementCompletionNotFoundError();
    this.assertScope(operation, input.chapterId, input.imageId);
    const decision = await this.authorization.check({
      context: input.context,
      chapterId: operation.chapterId,
      permission: "images.replace",
    });
    if (decision.reason === "not-found")
      throw new ImageReplacementCompletionNotFoundError();
    if (!decision.allowed) throw new ImageReplacementCompletionDeniedError();
    if (operation.status === "failed")
      throw new ImageReplacementCompletionFailedError();
    if (
      operation.status === "completed" ||
      operation.status === "completing" ||
      operation.status === "uploaded"
    )
      return project(operation);

    let verified: Awaited<ReturnType<UploadTransferPort["verify"]>>;
    try {
      const transfer = await this.storageExecution.uploadTransferFor(
        operation.storageProfileId,
      );
      verified = await transfer.verify({
        key: operation.candidateStorageKey,
      });
    } catch (error) {
      if (error instanceof UploadTransferObjectNotFoundError)
        throw new ImageReplacementCompletionNotFoundError();
      if (error instanceof UploadTransferProviderError) throw error;
      throw error;
    }
    const verifiedContentType = verified.contentType
      ? normalizeContentType(verified.contentType)
      : operation.contentType;
    if (
      verified.key !== operation.candidateStorageKey ||
      verified.sizeBytes !== operation.sizeBytes ||
      verifiedContentType !== normalizeContentType(operation.contentType) ||
      !verified.etag?.trim()
    )
      throw new ImageReplacementCompletionInvalidError();

    operation =
      (await this.operations.markUploaded(operation.id, this.now())) ??
      operation;
    return project(operation);
  }

  private assertScope(
    operation: { chapterId: string; imageId: string },
    chapterId: string,
    imageId: string,
  ) {
    if (operation.chapterId !== chapterId || operation.imageId !== imageId)
      throw new ImageReplacementCompletionNotFoundError();
  }
}

function project(operation: {
  id: string;
  imageId: string;
  chapterId: string;
  status: string;
}): QueuedImageReplacementResult {
  if (
    operation.status !== "uploaded" &&
    operation.status !== "completing" &&
    operation.status !== "completed"
  )
    throw new ImageReplacementCompletionInvariantError();
  return {
    replacementId: operation.id,
    imageId: operation.imageId,
    chapterId: operation.chapterId,
    status: operation.status,
  };
}

function normalizeContentType(value: string): string {
  return value.split(";", 1)[0]?.trim().toLowerCase() ?? "";
}
