import { describe, expect, it, vi } from "vitest";
import type { ChapterPermissionService } from "../../apps/api/src/modules/chapters/application/services/chapter-permission.service.js";
import type {
  UploadAuditPort,
  UploadLifecycleBoundaryPort,
  UploadRepositoryPort,
} from "../../apps/api/src/modules/uploads/application/ports/upload.ports.js";
import {
  ChapterUploadService,
  UploadedObjectMismatchError,
  UploadedObjectNotFoundError,
} from "../../apps/api/src/modules/uploads/application/services/chapter-upload.service.js";
import {
  UploadTransferObjectNotFoundError,
  type UploadTransferPort,
} from "../../packages/storage/dist/port.js";

const permission = {
  check: vi.fn().mockResolvedValue({
    allowed: true,
    reason: "assigned",
    seriesId: "series-1",
  }),
} as unknown as ChapterPermissionService;
const context = { userId: "user-1", sessionId: "session-1" };
const pending = {
  id: "upload-1",
  chapterId: "chapter-1",
  storageKey: "uploads/series-1/chapter-1/upload-1.zip",
  originalFilename: "chapter.zip",
  contentType: "application/zip",
  sizeBytes: 4,
  etag: null,
  status: "pending" as const,
  createdBy: "user-1",
  createdAt: new Date(),
  updatedAt: new Date(),
};

function setup() {
  const uploads: UploadRepositoryPort = {
    createPending: vi.fn().mockResolvedValue(pending),
    claimForCompletion: vi.fn().mockResolvedValue({
      ...pending,
      status: "verifying",
    }),
    releaseCompletion: vi.fn().mockResolvedValue(undefined),
    claimForAbort: vi.fn().mockResolvedValue({
      ...pending,
      status: "aborting",
    }),
    releaseAbort: vi.fn().mockResolvedValue(undefined),
    findActiveByChapterId: vi.fn().mockResolvedValue(null),
    findByIdAndChapterId: vi.fn().mockResolvedValue(pending),
    removePending: vi.fn().mockResolvedValue(true),
    removeAborting: vi.fn().mockResolvedValue(true),
    recoverStaleClaims: vi.fn().mockResolvedValue(undefined),
    findStalePending: vi.fn().mockResolvedValue([]),
  };
  const lifecycle: UploadLifecycleBoundaryPort = {
    finalizeIfAuthorized: vi.fn().mockResolvedValue({
      outcome: "uploaded",
      upload: { ...pending, status: "uploaded", etag: "etag-1" },
    }),
    claimAbortIfAuthorized: vi.fn().mockResolvedValue({
      outcome: "claimed",
      upload: { ...pending, status: "aborting" },
    }),
  };
  const transfer: UploadTransferPort = {
    initiate: vi.fn().mockResolvedValue({
      mode: "single",
      method: "PUT",
      url: "https://s3.example/upload",
      headers: { "content-type": "application/zip" },
      expiresAt: new Date(Date.now() + 60_000).toISOString(),
    }),
    verify: vi.fn().mockResolvedValue({
      key: pending.storageKey,
      sizeBytes: 4,
      contentType: "application/zip",
      etag: "etag-1",
    }),
    abort: vi.fn().mockResolvedValue(undefined),
  };
  const audit: UploadAuditPort = {
    append: vi.fn().mockResolvedValue(undefined),
  };
  const service = new ChapterUploadService(
    permission,
    uploads,
    lifecycle,
    transfer,
    audit,
    512,
  );
  return { service, uploads, lifecycle, transfer, audit };
}

describe("chapter upload transfer lifecycle", () => {
  it("initiates pending state without marking the upload as uploaded", async () => {
    const { service, lifecycle, transfer, audit } = setup();
    await expect(
      service.initiate({
        context,
        chapterId: "chapter-1",
        filename: "chapter.zip",
        contentType: "application/zip",
        sizeBytes: 4,
      }),
    ).resolves.toMatchObject({ status: "pending", sizeBytes: 4 });
    expect(transfer.initiate).toHaveBeenCalledWith(
      expect.objectContaining({ key: expect.stringContaining("chapter-1") }),
    );
    expect(lifecycle.finalizeIfAuthorized).not.toHaveBeenCalled();
    expect(audit.append).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "chapter.upload.initiated",
        result: null,
        metadata: { result: "pending" },
      }),
    );
  });

  it("audits only the verified terminal completion as success", async () => {
    const { service, audit } = setup();
    await service.complete({
      context,
      chapterId: "chapter-1",
      uploadId: "upload-1",
    });
    expect(audit.append).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "chapter.upload.completed",
        result: "success",
        metadata: { result: "completed" },
      }),
    );
  });

  it("does not report success when database finalization fails", async () => {
    const { service, lifecycle } = setup();
    vi.mocked(lifecycle.finalizeIfAuthorized).mockRejectedValueOnce(
      new Error("db failed"),
    );
    await expect(
      service.complete({
        context,
        chapterId: "chapter-1",
        uploadId: "upload-1",
      }),
    ).rejects.toThrow("db failed");
  });

  it("rejects a missing object and a mismatched real size", async () => {
    const missing = setup();
    vi.mocked(missing.transfer.verify).mockRejectedValueOnce(
      new UploadTransferObjectNotFoundError(),
    );
    await expect(
      missing.service.complete({
        context,
        chapterId: "chapter-1",
        uploadId: "upload-1",
      }),
    ).rejects.toBeInstanceOf(UploadedObjectNotFoundError);

    const mismatch = setup();
    vi.mocked(mismatch.transfer.verify).mockResolvedValueOnce({
      key: pending.storageKey,
      sizeBytes: 3,
      contentType: "application/zip",
    });
    await expect(
      mismatch.service.complete({
        context,
        chapterId: "chapter-1",
        uploadId: "upload-1",
      }),
    ).rejects.toBeInstanceOf(UploadedObjectMismatchError);
    expect(mismatch.lifecycle.finalizeIfAuthorized).not.toHaveBeenCalled();
  });

  it("aborts provider state before removing pending database state", async () => {
    const { service, uploads, transfer } = setup();
    await service.abort({
      context,
      chapterId: "chapter-1",
      uploadId: "upload-1",
    });
    expect(transfer.abort).toHaveBeenCalledWith({ key: pending.storageKey });
    expect(uploads.removeAborting).toHaveBeenCalledWith("upload-1");
  });

  it("expires abandoned pending uploads with a retryable provider cleanup", async () => {
    const { service, uploads, transfer, audit } = setup();
    vi.mocked(uploads.findStalePending).mockResolvedValueOnce([pending]);
    const cleaned = await service.cleanupStale(new Date(), 20);
    expect(cleaned).toBe(1);
    expect(uploads.recoverStaleClaims).toHaveBeenCalledOnce();
    expect(transfer.abort).toHaveBeenCalledWith({ key: pending.storageKey });
    expect(audit.append).toHaveBeenCalledWith(
      expect.objectContaining({ action: "chapter.upload.expired" }),
    );
  });
});
