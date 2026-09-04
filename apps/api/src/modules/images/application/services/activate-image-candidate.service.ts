import type { AuthorizationContext } from "../../../authorization/domain/authorization.types.js";
import { MediaStorageKey } from "../../domain/media-storage-key.js";
import { MediaVersion } from "../../domain/media-version.js";
import { PublicMediaUrl } from "../../domain/public-media-url.js";
import type {
  CanonicalImageReplacementResult,
  MediaReplacementRepositoryPort,
} from "../media-replacement.ports.js";

export class ImageCandidateActivationNotFoundError extends Error {}

export class ActivateImageCandidateService {
  constructor(
    private readonly repository: MediaReplacementRepositoryPort,
    private readonly publicMediaOrigin: string,
  ) {}

  async execute(input: {
    context: AuthorizationContext;
    imageId: string;
    candidateStorageKey: string;
    contentType: string;
    sizeBytes: number;
    checksum: string;
    operationId: string;
    requestId?: string;
    durableCompletion?: {
      completedAt: Date;
    };
  }): Promise<CanonicalImageReplacementResult> {
    const result = await this.repository.withLockedImage(
      input.imageId,
      async (transaction) => {
        const current = transaction.image.current;
        const nextVersion = MediaVersion.parse(current.version).next();
        const candidate = MediaStorageKey.parseExisting(
          input.candidateStorageKey,
        );
        if (
          candidate.seriesSlug !== transaction.image.seriesSlug ||
          candidate.chapterPublicKey !== transaction.image.chapterPublicKey
        )
          throw new Error("image-candidate-invalid");
        PublicMediaUrl.fromImage(this.publicMediaOrigin, {
          seriesPublicSlug: transaction.image.seriesSlug,
          chapterPublicKey: transaction.image.chapterPublicKey,
          filename: candidate.physicalFilename,
          contentType: input.contentType,
        });
        const oldPublicUrl = PublicMediaUrl.fromImage(this.publicMediaOrigin, {
          seriesPublicSlug: transaction.image.seriesSlug,
          chapterPublicKey: transaction.image.chapterPublicKey,
          filename: current.physicalFilename,
          contentType: current.contentType,
        }).toString();
        const cutover = await transaction.cutover({
          operationId: input.operationId,
          actorId: input.context.userId,
          ...(input.requestId ? { requestId: input.requestId } : {}),
          oldPublicUrl,
          next: {
            version: nextVersion.toNumber(),
            physicalFilename: candidate.physicalFilename,
            storageKey: candidate.storageKey,
            extension: candidate.extension,
            contentType: input.contentType,
            sizeBytes: input.sizeBytes,
            checksum: input.checksum,
          },
        });
        if (input.durableCompletion) {
          await transaction.completeReplacementOperation({
            operationId: input.operationId,
            imageId: transaction.image.id,
            resultImageVersionId: cutover.versionId,
            completedAt: input.durableCompletion.completedAt,
          });
        }
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
            contentType: input.contentType,
          }).toString(),
        };
      },
    );
    if (!result) throw new ImageCandidateActivationNotFoundError();
    return result;
  }
}
