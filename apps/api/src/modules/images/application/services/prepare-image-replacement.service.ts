import { randomUUID } from "node:crypto";
import type { AuthorizationContext } from "../../../authorization/domain/authorization.types.js";
import { createImageCandidateStorageKey } from "../../domain/image-candidate-storage-key.js";
import type { ImageReplacementOperationRepository } from "../image-replacement-operation.repository.js";
import type {
  ChapterImageAuthorizationPort,
  ImageRepositoryPort,
} from "../ports.js";

export class ImageReplacementPrepareDeniedError extends Error {}
export class ImageReplacementPrepareNotFoundError extends Error {}
export class ImageReplacementPrepareInvalidError extends Error {}

const supportedContentTypes = new Set([
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/gif",
]);

export class PrepareImageReplacementService {
  constructor(
    private readonly images: ImageRepositoryPort,
    private readonly authorization: ChapterImageAuthorizationPort,
    private readonly operations: ImageReplacementOperationRepository,
    private readonly maxSizeBytes: number,
  ) {}

  async execute(input: {
    context: AuthorizationContext;
    chapterId: string;
    imageId: string;
    filename: string;
    contentType: string;
    sizeBytes: number;
  }) {
    const image = await this.images.findById(input.imageId);
    if (!image || image.chapterId !== input.chapterId)
      throw new ImageReplacementPrepareNotFoundError();
    const decision = await this.authorization.check({
      context: input.context,
      chapterId: input.chapterId,
      permission: "images.replace",
    });
    if (!decision.allowed) throw new ImageReplacementPrepareDeniedError();
    const contentType = input.contentType
      .split(";", 1)[0]
      ?.trim()
      .toLowerCase();
    if (
      !contentType ||
      !supportedContentTypes.has(contentType) ||
      input.filename.toLowerCase().endsWith(".zip") ||
      !Number.isSafeInteger(input.sizeBytes) ||
      input.sizeBytes <= 0 ||
      input.sizeBytes > this.maxSizeBytes
    )
      throw new ImageReplacementPrepareInvalidError();
    const replacementId = randomUUID();
    const candidateStorageKey = createImageCandidateStorageKey({
      replacementId,
      currentStorageKey: image.storageKey,
      contentType,
    });
    const operation = await this.operations.create({
      id: replacementId,
      imageId: image.id,
      chapterId: input.chapterId,
      requestedByUserId: input.context.userId,
      candidateStorageKey,
      originalFilename: input.filename,
      contentType,
      sizeBytes: input.sizeBytes,
      status: "pending_upload",
    });
    return {
      replacementId: operation.id,
      imageId: operation.imageId,
      chapterId: operation.chapterId,
      candidateStorageKey: operation.candidateStorageKey,
      contentType: operation.contentType,
      sizeBytes: operation.sizeBytes,
    };
  }
}
