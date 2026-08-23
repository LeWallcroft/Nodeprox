import { Readable } from "node:stream";
import { describe, expect, it, vi } from "vitest";
import type { ChapterPermissionService } from "../../apps/api/src/modules/chapters/application/services/chapter-permission.service.js";
import { ChapterUploadService } from "../../apps/api/src/modules/uploads/application/services/chapter-upload.service.js";
import type { StoragePort } from "../../apps/api/src/modules/uploads/application/ports/storage.ports.js";
import type {
  UploadAuditPort,
  UploadRepositoryPort,
} from "../../apps/api/src/modules/uploads/application/ports/upload.ports.js";

const permission = {
  check: vi.fn().mockResolvedValue({ allowed: true, reason: "owner" }),
} as unknown as ChapterPermissionService;
const context = { userId: "user-1", sessionId: "session-1" };

function setup() {
  const uploads: UploadRepositoryPort = {
    createPending: vi.fn().mockResolvedValue({}),
    markUploaded: vi.fn().mockResolvedValue({}),
    findActiveByChapterId: vi.fn().mockResolvedValue(null),
    removePending: vi.fn().mockResolvedValue(undefined),
  };
  const storage: StoragePort = {
    put: vi.fn().mockResolvedValue({
      key: "key",
      sizeBytes: 4,
      contentType: "application/zip",
    }),
    delete: vi.fn().mockResolvedValue(undefined),
    exists: vi.fn().mockResolvedValue(true),
  };
  const audit: UploadAuditPort = {
    append: vi.fn().mockResolvedValue(undefined),
  };
  const service = new ChapterUploadService(
    permission,
    uploads,
    storage,
    audit,
    512,
  );
  return { service, uploads, storage, audit };
}

function input() {
  return {
    context,
    chapterId: "chapter-1",
    file: {
      stream: Readable.from([Buffer.from("PK\\x03\\x04")]),
      filename: "chapter.zip",
      contentType: "application/zip",
      sizeBytes: 4,
      magicBytes: Uint8Array.from([0x50, 0x4b, 0x03, 0x04]),
    },
  };
}

describe("chapter upload compensation", () => {
  it("marks uploaded only after storage and database succeed", async () => {
    const { service, uploads, storage } = setup();
    await expect(service.upload(input())).resolves.toMatchObject({
      status: "uploaded",
    });
    expect(storage.put).toHaveBeenCalledOnce();
    expect(uploads.markUploaded).toHaveBeenCalledOnce();
    expect(storage.delete).not.toHaveBeenCalled();
  });

  it("does not report success when storage put fails", async () => {
    const { service, uploads, storage } = setup();
    vi.mocked(storage.put).mockRejectedValueOnce(new Error("put failed"));
    await expect(service.upload(input())).rejects.toThrow("put failed");
    expect(uploads.markUploaded).not.toHaveBeenCalled();
    expect(uploads.removePending).toHaveBeenCalled();
  });

  it("deletes the object when database finalization fails", async () => {
    const { service, uploads, storage } = setup();
    vi.mocked(uploads.markUploaded).mockRejectedValueOnce(
      new Error("db failed"),
    );
    await expect(service.upload(input())).rejects.toThrow("db failed");
    expect(storage.delete).toHaveBeenCalledWith(
      expect.stringContaining("chapters/chapter-1/uploads/"),
    );
    expect(uploads.removePending).toHaveBeenCalled();
  });

  it("keeps failure unsuccessful and audits safely when compensation fails", async () => {
    const { service, uploads, storage, audit } = setup();
    vi.mocked(uploads.markUploaded).mockRejectedValueOnce(
      new Error("db failed"),
    );
    vi.mocked(storage.delete).mockRejectedValueOnce(new Error("delete failed"));
    await expect(service.upload(input())).rejects.toThrow("db failed");
    expect(vi.mocked(audit.append).mock.calls.at(-1)?.[0]).toMatchObject({
      action: "chapter.upload.failed",
      metadata: { result: "failed" },
    });
    expect(JSON.stringify(vi.mocked(audit.append).mock.calls)).not.toContain(
      "delete failed",
    );
    expect(JSON.stringify(vi.mocked(audit.append).mock.calls)).not.toContain(
      "db failed",
    );
  });
});
