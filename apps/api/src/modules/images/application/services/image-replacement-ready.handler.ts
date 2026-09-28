import type { StorageExecutionResolver } from "@nodeprox/storage/profile-execution";
import {
  UploadTransferObjectNotFoundError,
  type UploadTransferPort,
} from "@nodeprox/storage/port";
import { z } from "zod";
import type {
  DomainEventEnvelope,
  DomainEventHandler,
} from "../../../events/application/domain-event-handler.js";
import type { ImageReplacementOperationRepository } from "../image-replacement-operation.repository.js";
import type { ActivateImageCandidateService } from "./activate-image-candidate.service.js";

const payloadSchema = z.object({
  targetUserId: z.uuid(),
  chapterId: z.uuid(),
  imageId: z.uuid(),
});

export class ImageReplacementReadyHandler implements DomainEventHandler {
  readonly handlerName = "image-replacement-ready-handler";
  readonly eventTypes = ["image.replacement.ready"] as const;

  constructor(
    private readonly operations: ImageReplacementOperationRepository,
    private readonly storageExecution: StorageExecutionResolver,
    private readonly activator: Pick<ActivateImageCandidateService, "execute">,
    private readonly now: () => Date = () => new Date(),
  ) {}

  async handle(event: DomainEventEnvelope): Promise<void> {
    const payload = payloadSchema.parse(event.payload);
    let operation = await this.operations.findById(event.aggregateId);
    if (!operation) throw new Error("image-replacement-not-found");
    if (
      operation.chapterId !== payload.chapterId ||
      operation.imageId !== payload.imageId
    )
      throw new Error("image-replacement-scope-invalid");
    if (operation.status === "completed") return;
    if (operation.status === "failed")
      throw new Error("image-replacement-failed");

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
        return this.fail(operation.id, "image-replacement-candidate-not-found");
      throw error;
    }
    const contentType = normalizeContentType(
      verified.contentType ?? operation.contentType,
    );
    if (
      verified.key !== operation.candidateStorageKey ||
      verified.sizeBytes !== operation.sizeBytes ||
      contentType !== normalizeContentType(operation.contentType) ||
      !verified.etag?.trim()
    )
      return this.fail(operation.id, "image-replacement-upload-invalid");

    if (operation.status === "uploaded") {
      const claim = await this.operations.tryBeginCompletion(
        operation.id,
        this.now(),
      );
      if (!claim.operation) throw new Error("image-replacement-not-found");
      operation = claim.operation;
      if (!claim.acquired) {
        if (operation.status === "completed") return;
        throw new Error("image-replacement-completion-in-progress");
      }
    }
    if (operation.status !== "completing")
      throw new Error("image-replacement-state-invalid");

    await this.activator.execute({
      context: {
        userId: payload.targetUserId,
        sessionId: `background:${event.id}`,
      },
      imageId: operation.imageId,
      candidateStorageKey: operation.candidateStorageKey,
      storageProfileId: operation.storageProfileId,
      contentType,
      sizeBytes: verified.sizeBytes,
      checksum: verified.etag,
      operationId: operation.id,
      durableCompletion: { completedAt: this.now() },
    });
  }

  private async fail(operationId: string, errorCode: string): Promise<void> {
    await this.operations.markFailed({
      operationId,
      errorCode,
      updatedAt: this.now(),
    });
  }
}

function normalizeContentType(value: string): string {
  return value.split(";", 1)[0]?.trim().toLowerCase() ?? "";
}
