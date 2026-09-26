import { randomUUID } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import type {
  ImageReplacementOperation,
  ImageReplacementOperationRepository,
} from "../../apps/api/src/modules/images/application/image-replacement-operation.repository.js";
import { ImageReplacementReadyHandler } from "../../apps/api/src/modules/images/application/services/image-replacement-ready.handler.js";
import type { UploadTransferPort } from "../../packages/storage/dist/port.js";
import { UploadTransferObjectNotFoundError } from "../../packages/storage/dist/port.js";

const now = new Date("2026-09-18T12:00:00.000Z");
const targetUserId = randomUUID();
const operation: ImageReplacementOperation = {
  id: randomUUID(),
  imageId: randomUUID(),
  chapterId: randomUUID(),
  requestedByUserId: targetUserId,
  candidateStorageKey: "Media/series/chapter/replacement.jpg",
  originalFilename: "replacement.jpg",
  contentType: "image/jpeg",
  sizeBytes: 20,
  status: "uploaded",
  resultImageVersionId: null,
  lastErrorCode: null,
  createdAt: now,
  updatedAt: now,
  completedAt: null,
};

function subject(
  verified = {
    key: operation.candidateStorageKey,
    sizeBytes: operation.sizeBytes,
    contentType: operation.contentType,
    etag: "etag-1",
  },
) {
  const completing = { ...operation, status: "completing" as const };
  const operations: ImageReplacementOperationRepository = {
    create: vi.fn(),
    findById: vi.fn(async () => operation),
    markUploaded: vi.fn(),
    tryBeginCompletion: vi.fn(async () => ({
      acquired: true,
      operation: completing,
    })),
    markCompleted: vi.fn(),
    markFailed: vi.fn(async () => ({
      ...operation,
      status: "failed" as const,
    })),
  };
  const transfer: UploadTransferPort = {
    initiate: vi.fn(),
    verify: vi.fn(async () => verified),
    abort: vi.fn(),
  };
  const activator = { execute: vi.fn(async () => undefined) };
  const handler = new ImageReplacementReadyHandler(
    operations,
    transfer,
    activator as never,
    () => now,
  );
  return { handler, operations, transfer, activator };
}

function event() {
  return {
    id: randomUUID(),
    eventType: "image.replacement.ready",
    aggregateType: "image_replacement_operation",
    aggregateId: operation.id,
    actorUserId: targetUserId,
    payload: {
      targetUserId,
      chapterId: operation.chapterId,
      imageId: operation.imageId,
    },
    occurredAt: now,
    attemptCount: 0,
  };
}

describe("ImageReplacementReadyHandler", () => {
  it("claims and activates the verified candidate in background", async () => {
    const target = subject();

    await target.handler.handle(event());

    expect(target.operations.tryBeginCompletion).toHaveBeenCalledWith(
      operation.id,
      now,
    );
    expect(target.activator.execute).toHaveBeenCalledWith({
      context: {
        userId: targetUserId,
        sessionId: expect.stringMatching(/^background:/),
      },
      imageId: operation.imageId,
      candidateStorageKey: operation.candidateStorageKey,
      contentType: operation.contentType,
      sizeBytes: operation.sizeBytes,
      checksum: "etag-1",
      operationId: operation.id,
      durableCompletion: { completedAt: now },
    });
  });

  it("marks invalid uploaded metadata as failed without activation", async () => {
    const target = subject({
      key: operation.candidateStorageKey,
      sizeBytes: operation.sizeBytes + 1,
      contentType: operation.contentType,
      etag: "etag-1",
    });

    await target.handler.handle(event());

    expect(target.operations.markFailed).toHaveBeenCalledWith({
      operationId: operation.id,
      errorCode: "image-replacement-upload-invalid",
      updatedAt: now,
    });
    expect(target.activator.execute).not.toHaveBeenCalled();
  });

  it("marks a missing durable candidate as a terminal failure", async () => {
    const target = subject();
    vi.mocked(target.transfer.verify).mockRejectedValue(
      new UploadTransferObjectNotFoundError(),
    );

    await target.handler.handle(event());

    expect(target.operations.markFailed).toHaveBeenCalledWith({
      operationId: operation.id,
      errorCode: "image-replacement-candidate-not-found",
      updatedAt: now,
    });
    expect(target.operations.tryBeginCompletion).not.toHaveBeenCalled();
    expect(target.activator.execute).not.toHaveBeenCalled();
  });
});
