import { describe, expect, it, vi } from "vitest";
import type { StorageCleanupRepositoryPort } from "../../apps/worker/src/storage-cleanup/application/ports.js";
import { StorageCleanupProcessor } from "../../apps/worker/src/storage-cleanup/application/storage-cleanup.processor.js";
import type { StoragePort } from "@nodeprox/storage/port";

function harness(safe: boolean, deleteFails = false) {
  const effect = {
    id: "cleanup",
    replacementId: "replacement",
    storageKey: "artifact",
    reason: "replacement_source_zip" as const,
    attempts: 1,
  };
  const repository: StorageCleanupRepositoryPort = {
    claimPending: vi.fn().mockResolvedValue([effect]),
    isSafeToDelete: vi.fn().mockResolvedValue(safe),
    markCompleted: vi.fn(),
    markRetry: vi.fn(),
    markFailed: vi.fn(),
  };
  const storage: StoragePort = {
    put: vi.fn(),
    get: vi.fn(),
    delete: deleteFails
      ? vi.fn().mockRejectedValue(new Error("temporary"))
      : vi.fn(),
    exists: vi.fn(),
  };
  const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };
  return {
    repository,
    storage,
    processor: new StorageCleanupProcessor(repository, storage, logger),
  };
}

describe("CHR3 storage cleanup processor", () => {
  it("CHR3-CLN-09 transient delete failure schedules retry", async () => {
    const target = harness(true, true);
    await target.processor.runOnce();
    expect(target.repository.markRetry).toHaveBeenCalledTimes(1);
    expect(target.repository.markCompleted).not.toHaveBeenCalled();
  });

  it("CHR3-CLN-10 uncertain ownership fails closed without deletion", async () => {
    const target = harness(false);
    await target.processor.runOnce();
    expect(target.storage.delete).not.toHaveBeenCalled();
    expect(target.repository.markFailed).toHaveBeenCalledWith(
      "cleanup",
      "storage-cleanup-not-safe",
    );
  });
});
