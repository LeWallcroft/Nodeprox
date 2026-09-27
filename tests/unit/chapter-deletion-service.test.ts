import { Readable } from "node:stream";
import { describe, expect, it, vi } from "vitest";
import { ChapterDeletionService } from "../../apps/worker/src/deletion/application/chapter-deletion.service.js";
import type { ChapterDeletionRepositoryPort } from "../../apps/worker/src/deletion/application/ports.js";
import type { StoragePort } from "@nodeprox/storage/port";
import {
  legacyStorageExecution,
  legacyStorageProfileId,
} from "../helpers/storage-execution.js";

const input = {
  deletionId: "11111111-1111-4111-8111-111111111111",
  chapterId: "22222222-2222-4222-8222-222222222222",
};

function repository(): ChapterDeletionRepositoryPort {
  return {
    load: vi.fn(async () => ({
      ...input,
      requestedBy: "33333333-3333-4333-8333-333333333333",
      storageObjects: [
        "Media/prueba1/6/01.jpg",
        "Uploads/a/source.zip",
        "Media/prueba1/6/01.jpg",
      ].map((storageKey) => ({
        storageProfileId: legacyStorageProfileId,
        storageKey,
      })),
    })),
    finalize: vi.fn(async () => undefined),
  };
}

function storage(remove: StoragePort["delete"]): StoragePort {
  return {
    put: vi.fn(async (value) => ({
      key: value.key,
      sizeBytes: value.sizeBytes,
      contentType: value.contentType,
    })),
    get: vi.fn(async () => Readable.from([])),
    exists: vi.fn(async () => false),
    delete: remove,
  };
}

describe("ChapterDeletionService", () => {
  it("deletes identical keys independently in two pinned profiles", async () => {
    const profileB = "11111111-1111-4111-8111-111111111111";
    const key = "Media/shared/1/01.webp";
    const repo = repository();
    vi.mocked(repo.load).mockResolvedValue({
      ...input,
      requestedBy: "actor",
      storageObjects: [
        { storageProfileId: legacyStorageProfileId, storageKey: key },
        { storageProfileId: profileB, storageKey: key },
      ],
    });
    const deleteA = vi.fn(async () => undefined);
    const deleteB = vi.fn(async () => undefined);
    const first = storage(deleteA);
    const second = storage(deleteB);
    const service = new ChapterDeletionService(repo, {
      storageFor: async (id) =>
        id === legacyStorageProfileId ? first : second,
      uploadTransferFor: async () => {
        throw new Error("unused");
      },
    });
    await service.execute(input);
    expect(deleteA).toHaveBeenCalledWith(key);
    expect(deleteB).toHaveBeenCalledWith(key);
    expect(repo.finalize).toHaveBeenCalledOnce();
  });

  it("deletes each persisted key once and finalizes only afterwards", async () => {
    const repo = repository();
    const remove = vi.fn(async (_key: string) => undefined);
    await new ChapterDeletionService(
      repo,
      legacyStorageExecution(storage(remove)),
    ).execute(input);
    expect(remove.mock.calls.map(([key]) => key)).toEqual([
      "Media/prueba1/6/01.jpg",
      "Uploads/a/source.zip",
    ]);
    expect(repo.finalize).toHaveBeenCalledWith(
      input.deletionId,
      input.chapterId,
    );
  });

  it("leaves durable DB state intact after a transient storage failure and retries safely", async () => {
    const repo = repository();
    let failed = false;
    const remove = vi.fn(async (_key: string) => {
      if (!failed) {
        failed = true;
        throw new Error("temporary-storage-error");
      }
    });
    const service = new ChapterDeletionService(
      repo,
      legacyStorageExecution(storage(remove)),
    );
    await expect(service.execute(input)).rejects.toThrow(
      "temporary-storage-error",
    );
    expect(repo.finalize).not.toHaveBeenCalled();
    await expect(service.execute(input)).resolves.toBeUndefined();
    expect(repo.finalize).toHaveBeenCalledOnce();
  });

  it("treats an already completed deletion as an idempotent success", async () => {
    const repo = repository();
    vi.mocked(repo.load).mockResolvedValue(null);
    const remove = vi.fn(async (_key: string) => undefined);
    await expect(
      new ChapterDeletionService(
        repo,
        legacyStorageExecution(storage(remove)),
      ).execute(input),
    ).resolves.toBeUndefined();
    expect(remove).not.toHaveBeenCalled();
    expect(repo.finalize).not.toHaveBeenCalled();
  });
});
