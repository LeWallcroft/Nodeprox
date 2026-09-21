import { randomUUID } from "node:crypto";
import type { Readable } from "node:stream";
import type { StoragePort } from "@nodeprox/storage/port";
import type { AuthorizationContext } from "../../../authorization/domain/authorization.types.js";
import { createImageCandidateStorageKey } from "../../domain/image-candidate-storage-key.js";
import type {
  MediaReplacementObservabilityPort,
  MediaReplacementRepositoryPort,
} from "../media-replacement.ports.js";
import type { ChapterImageAuthorizationPort } from "../ports.js";
import {
  ActivateImageCandidateService,
  ImageCandidateActivationNotFoundError,
} from "./activate-image-candidate.service.js";

export class ImageReplacementNotFoundError extends Error {}
export class ImageReplacementDeniedError extends Error {}
export class ImageReplacementInvalidError extends Error {}
export class ImageReplacementStorageError extends Error {}

export class ReplaceImageService {
  private readonly activator: Pick<ActivateImageCandidateService, "execute">;

  constructor(
    private readonly repository: MediaReplacementRepositoryPort,
    private readonly authorization: ChapterImageAuthorizationPort,
    private readonly storage: StoragePort,
    publicMediaOrigin: string,
    private readonly observability: MediaReplacementObservabilityPort,
    activator?: Pick<ActivateImageCandidateService, "execute">,
  ) {
    this.activator =
      activator ??
      new ActivateImageCandidateService(repository, publicMediaOrigin);
  }

  async execute(input: {
    context: AuthorizationContext;
    imageId: string;
    body: Readable;
    contentType: string;
    sizeBytes: number;
    checksum: string;
    requestId?: string;
  }) {
    if (
      !Number.isSafeInteger(input.sizeBytes) ||
      input.sizeBytes <= 0 ||
      input.checksum.trim().length === 0
    )
      throw new ImageReplacementInvalidError();

    const candidateContext = await this.repository.findCandidateContext(
      input.imageId,
    );
    if (!candidateContext) throw new ImageReplacementNotFoundError();
    const decision = await this.authorization.check({
      context: input.context,
      chapterId: candidateContext.chapterId,
      permission: "images.replace",
    });
    if (decision.reason === "not-found")
      throw new ImageReplacementNotFoundError();
    if (!decision.allowed) throw new ImageReplacementDeniedError();

    const operationId = randomUUID();
    const contentType = normalizeContentType(input.contentType);
    if (contentType !== candidateContext.currentContentType)
      throw new ImageReplacementInvalidError();
    const candidateKey = createImageCandidateStorageKey({
      currentStorageKey: candidateContext.currentStorageKey,
      logicalFilename: candidateContext.logicalFilename,
      nextVersion: candidateContext.currentVersion + 1,
      contentType,
    });
    let objectWritten = false;
    try {
      const stored = await this.storage.put({
        key: candidateKey,
        body: input.body,
        contentType,
        sizeBytes: input.sizeBytes,
      });
      objectWritten = true;
      const storedContentType = normalizeContentType(stored.contentType);
      if (
        stored.key !== candidateKey ||
        stored.sizeBytes !== input.sizeBytes ||
        storedContentType !== contentType ||
        !(await this.storage.exists(candidateKey))
      )
        throw new ImageReplacementStorageError();

      return await this.activator.execute({
        context: input.context,
        imageId: input.imageId,
        candidateStorageKey: stored.key,
        contentType: storedContentType,
        sizeBytes: stored.sizeBytes,
        checksum: input.checksum,
        operationId,
        ...(input.requestId ? { requestId: input.requestId } : {}),
      });
    } catch (error) {
      if (objectWritten) {
        try {
          await this.storage.delete(candidateKey);
        } catch (cleanupError) {
          try {
            await this.repository.enqueueOrphanCleanup({
              operationId,
              imageId: input.imageId,
              storageKey: candidateKey,
            });
          } catch {
            this.observability.orphanCandidate({
              operationId,
              imageId: input.imageId,
              storageKey: candidateKey,
              errorName:
                cleanupError instanceof Error
                  ? cleanupError.name
                  : "UnknownCleanupError",
            });
          }
        }
      }
      if (error instanceof ImageCandidateActivationNotFoundError)
        throw new ImageReplacementNotFoundError();
      throw error;
    }
  }
}

function normalizeContentType(value: string): string {
  return value.split(";", 1)[0]?.trim().toLowerCase() ?? "";
}
