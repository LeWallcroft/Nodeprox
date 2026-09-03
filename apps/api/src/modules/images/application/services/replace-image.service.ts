import { randomUUID } from "node:crypto";
import type { Readable } from "node:stream";
import type { StoragePort } from "@nodeprox/storage/port";
import type { AuthorizationContext } from "../../../authorization/domain/authorization.types.js";
import type { ChapterImageAuthorizationPort } from "../ports.js";
import type {
  MediaReplacementObservabilityPort,
  MediaReplacementRepositoryPort,
} from "../media-replacement.ports.js";
import { MediaStorageKey } from "../../domain/media-storage-key.js";
import { MediaVersion } from "../../domain/media-version.js";
import { PublicMediaUrl } from "../../domain/public-media-url.js";

export class ImageReplacementNotFoundError extends Error {}
export class ImageReplacementDeniedError extends Error {}
export class ImageReplacementInvalidError extends Error {}
export class ImageReplacementStorageError extends Error {}

export class ReplaceImageService {
  constructor(
    private readonly repository: MediaReplacementRepositoryPort,
    private readonly authorization: ChapterImageAuthorizationPort,
    private readonly storage: StoragePort,
    private readonly publicMediaOrigin: string,
    private readonly observability: MediaReplacementObservabilityPort,
  ) {}

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

    const chapterId = await this.repository.findChapterId(input.imageId);
    if (!chapterId) throw new ImageReplacementNotFoundError();
    const decision = await this.authorization.check({
      context: input.context,
      chapterId,
      permission: "images.replace",
    });
    if (decision.reason === "not-found")
      throw new ImageReplacementNotFoundError();
    if (!decision.allowed) throw new ImageReplacementDeniedError();

    const operationId = randomUUID();
    let candidateKey: string | undefined;
    let objectWritten = false;
    try {
      const result = await this.repository.withLockedImage(
        input.imageId,
        async (transaction) => {
          const current = transaction.image.current;
          if (normalizeContentType(input.contentType) !== current.contentType)
            throw new ImageReplacementInvalidError();

          const nextVersion = MediaVersion.parse(current.version).next();
          const candidate = MediaStorageKey.forVersion({
            seriesSlug: transaction.image.seriesSlug,
            chapterPublicKey: transaction.image.chapterPublicKey,
            logicalFilename: transaction.image.logicalFilename,
            version: nextVersion,
          });
          candidateKey = candidate.storageKey;
          const stored = await this.storage.put({
            key: candidate.storageKey,
            body: input.body,
            contentType: current.contentType,
            sizeBytes: input.sizeBytes,
          });
          objectWritten = true;
          if (
            stored.key !== candidate.storageKey ||
            stored.sizeBytes !== input.sizeBytes ||
            normalizeContentType(stored.contentType) !== current.contentType ||
            !(await this.storage.exists(candidate.storageKey))
          )
            throw new ImageReplacementStorageError();

          const oldPublicUrl = PublicMediaUrl.fromImage(
            this.publicMediaOrigin,
            {
              seriesPublicSlug: transaction.image.seriesSlug,
              chapterPublicKey: transaction.image.chapterPublicKey,
              filename: current.physicalFilename,
              contentType: current.contentType,
            },
          ).toString();
          const cutover = await transaction.cutover({
            operationId,
            actorId: input.context.userId,
            ...(input.requestId ? { requestId: input.requestId } : {}),
            oldPublicUrl,
            next: {
              version: nextVersion.toNumber(),
              physicalFilename: candidate.physicalFilename,
              storageKey: candidate.storageKey,
              extension: current.extension,
              contentType: current.contentType,
              sizeBytes: input.sizeBytes,
              checksum: input.checksum,
            },
          });
          return {
            imageId: transaction.image.id,
            versionId: cutover.versionId,
            version: nextVersion.toNumber(),
            filename: candidate.physicalFilename,
            storageKey: candidate.storageKey,
            publicUrl: PublicMediaUrl.fromImage(this.publicMediaOrigin, {
              seriesPublicSlug: transaction.image.seriesSlug,
              chapterPublicKey: transaction.image.chapterPublicKey,
              filename: candidate.physicalFilename,
              contentType: current.contentType,
            }).toString(),
          };
        },
      );
      if (!result) throw new ImageReplacementNotFoundError();
      return result;
    } catch (error) {
      if (objectWritten && candidateKey) {
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
      throw error;
    }
  }
}

function normalizeContentType(value: string): string {
  return value.split(";", 1)[0]?.trim().toLowerCase() ?? "";
}
