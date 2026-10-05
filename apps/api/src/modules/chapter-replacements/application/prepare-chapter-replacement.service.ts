import { randomUUID } from "node:crypto";
import {
  type UploadTransferGrant,
  UploadTransferProviderError,
} from "@nodeprox/storage/port";
import type {
  ActiveStorageProfilePort,
  StorageExecutionResolver,
} from "@nodeprox/storage/profile-execution";
import type { AuthorizationContext } from "../../authorization/domain/authorization.types.js";
import type { ChapterImageAuthorizationPort } from "../../images/application/ports.js";
import { validateUploadMetadata } from "../../uploads/domain/upload.policy.js";
import { createChapterReplacementSourceKey } from "../domain/chapter-replacement-source-key.js";
import type { ChapterReplacementUploadRepository } from "./ports/chapter-replacement-upload.repository.js";

const GRANT_TTL_SECONDS = 15 * 60;

export class ChapterReplacementPrepareDeniedError extends Error {}
export class ChapterReplacementPrepareNotFoundError extends Error {}
export class ChapterReplacementPrepareConflictError extends Error {}
export class ChapterReplacementPrepareProviderError extends Error {}

export type PreparedChapterReplacement = {
  replacementId: string;
  chapterId: string;
  upload: UploadTransferGrant;
};

export class PrepareChapterReplacementService {
  constructor(
    private readonly authorization: ChapterImageAuthorizationPort,
    private readonly repository: ChapterReplacementUploadRepository,
    private readonly storageExecution: StorageExecutionResolver,
    private readonly activeProfile: ActiveStorageProfilePort,
    private readonly maxSizeBytes: number,
    private readonly logger?: { error(context: object, message: string): void },
  ) {}

  async execute(input: {
    context: AuthorizationContext;
    chapterId: string;
    filename: string;
    contentType: string;
    sizeBytes: number;
  }): Promise<PreparedChapterReplacement> {
    const decision = await this.authorization.check({
      context: input.context,
      chapterId: input.chapterId,
      permission: "chapters.replace",
    });
    if (decision.reason === "not-found")
      throw new ChapterReplacementPrepareNotFoundError();
    if (!decision.allowed) throw new ChapterReplacementPrepareDeniedError();

    const metadata = validateUploadMetadata({
      filename: input.filename,
      contentType: input.contentType,
      sizeBytes: input.sizeBytes,
      maxSizeBytes: this.maxSizeBytes,
    });
    const replacementId = randomUUID();
    const sourceKey = createChapterReplacementSourceKey({
      chapterId: input.chapterId,
      replacementId,
    });
    const storageProfileId =
      await this.activeProfile.getActiveStorageProfileId();
    const operation = await this.repository.createPending({
      id: replacementId,
      chapterId: input.chapterId,
      requestedByUserId: input.context.userId,
      candidateZipStorageKey: sourceKey,
      storageProfileId,
      originalFilename: metadata.filename,
      contentType: metadata.contentType,
      sizeBytes: input.sizeBytes,
    });
    if (!operation) throw new ChapterReplacementPrepareConflictError();

    try {
      const transfer = await this.storageExecution.uploadTransferFor(
        operation.storageProfileId,
      );
      const upload = await transfer.initiate({
        key: operation.candidateZipStorageKey,
        contentType: operation.contentType,
        sizeBytes: operation.sizeBytes,
        expiresInSeconds: GRANT_TTL_SECONDS,
      });
      return {
        replacementId: operation.id,
        chapterId: operation.chapterId,
        upload,
      };
    } catch (error) {
      try {
        await this.repository.markPreparationFailed(
          operation.id,
          "replacement-upload-initiate-failed",
        );
      } catch (markError) {
        this.logger?.error(
          { replacementId: operation.id, error: markError },
          "replacement.prepare.failure_recording_failed",
        );
      }
      if (error instanceof UploadTransferProviderError)
        throw new ChapterReplacementPrepareProviderError();
      throw error;
    }
  }
}
