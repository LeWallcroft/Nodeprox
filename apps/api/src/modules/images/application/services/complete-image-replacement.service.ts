import type { UploadTransferPort } from "@nodeprox/storage/port";
import type { AuthorizationContext } from "../../../authorization/domain/authorization.types.js";
import type {
  ImageReplacementOperation,
  ImageReplacementOperationRepository,
} from "../image-replacement-operation.repository.js";
import type { ImageVersionResultRepository } from "../image-version-result.repository.js";
import type { CanonicalImageReplacementResult } from "../media-replacement.ports.js";
import type { ChapterImageAuthorizationPort } from "../ports.js";
import type { ActivateImageCandidateService } from "./activate-image-candidate.service.js";

export class ImageReplacementCompletionNotFoundError extends Error {}
export class ImageReplacementCompletionDeniedError extends Error {}
export class ImageReplacementCompletionInvalidError extends Error {}
export class ImageReplacementCompletionInProgressError extends Error {}
export class ImageReplacementCompletionFailedError extends Error {}
export class ImageReplacementCompletionInvariantError extends Error {}

export class CompleteImageReplacementService {
  constructor(
    private readonly operations: ImageReplacementOperationRepository,
    private readonly versions: ImageVersionResultRepository,
    private readonly transfer: UploadTransferPort,
    private readonly activator: Pick<ActivateImageCandidateService, "execute">,
    private readonly authorization: ChapterImageAuthorizationPort,
    private readonly now: () => Date = () => new Date(),
  ) {}

  async execute(input: {
    context: AuthorizationContext;
    chapterId: string;
    imageId: string;
    replacementId: string;
    requestId?: string;
  }): Promise<CanonicalImageReplacementResult> {
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

    if (operation.status === "completed")
      return this.rehydrateCompleted(operation);
    if (operation.status === "completing")
      throw new ImageReplacementCompletionInProgressError();
    if (operation.status === "failed")
      throw new ImageReplacementCompletionFailedError();

    const verified = await this.transfer.verify({
      key: operation.candidateStorageKey,
    });
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

    const timestamp = this.now();
    if (operation.status === "pending_upload") {
      const uploaded = await this.operations.markUploaded(
        operation.id,
        timestamp,
      );
      if (!uploaded) throw new ImageReplacementCompletionNotFoundError();
      operation = uploaded;
      if (operation.status === "completed")
        return this.rehydrateCompleted(operation);
      if (operation.status === "completing")
        throw new ImageReplacementCompletionInProgressError();
      if (operation.status === "failed")
        throw new ImageReplacementCompletionFailedError();
    }

    const claim = await this.operations.tryBeginCompletion(
      operation.id,
      timestamp,
    );
    if (!claim.operation) throw new ImageReplacementCompletionNotFoundError();
    this.assertScope(claim.operation, input.chapterId, input.imageId);
    if (!claim.acquired) {
      if (claim.operation.status === "completed")
        return this.rehydrateCompleted(claim.operation);
      if (claim.operation.status === "failed")
        throw new ImageReplacementCompletionFailedError();
      throw new ImageReplacementCompletionInProgressError();
    }

    return this.activator.execute({
      context: input.context,
      imageId: operation.imageId,
      candidateStorageKey: operation.candidateStorageKey,
      contentType: verifiedContentType,
      sizeBytes: verified.sizeBytes,
      checksum: verified.etag,
      operationId: operation.id,
      ...(input.requestId ? { requestId: input.requestId } : {}),
      durableCompletion: { completedAt: timestamp },
    });
  }

  private async rehydrateCompleted(operation: ImageReplacementOperation) {
    if (!operation.resultImageVersionId || !operation.completedAt)
      throw new ImageReplacementCompletionInvariantError();
    const result = await this.versions.findVersionResultById(
      operation.resultImageVersionId,
    );
    if (!result || result.imageId !== operation.imageId)
      throw new ImageReplacementCompletionInvariantError();
    return result;
  }

  private assertScope(
    operation: ImageReplacementOperation,
    chapterId: string,
    imageId: string,
  ) {
    if (operation.chapterId !== chapterId || operation.imageId !== imageId)
      throw new ImageReplacementCompletionNotFoundError();
  }
}

function normalizeContentType(value: string): string {
  return value.split(";", 1)[0]?.trim().toLowerCase() ?? "";
}
