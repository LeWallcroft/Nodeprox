import { describe, expect, it, vi } from "vitest";
import type { StorageCleanupRepositoryPort } from "../../apps/worker/src/storage-cleanup/application/ports.js";
import { StorageCleanupProcessor } from "../../apps/worker/src/storage-cleanup/application/storage-cleanup.processor.js";
import { DrizzleStorageCleanupRepository } from "../../apps/worker/src/storage-cleanup/infrastructure/persistence/drizzle/storage-cleanup.repository.js";
import type { StoragePort } from "@nodeprox/storage/port";
import {
  legacyStorageExecution,
  legacyStorageProfileId,
} from "../helpers/storage-execution.js";

function harness(safe: boolean, deleteFails = false, originRequestId?: string) {
  const effect = {
    id: "cleanup",
    replacementId: "replacement",
    storageKey: "artifact",
    storageProfileId: legacyStorageProfileId,
    reason: "replacement_source_zip" as const,
    attempts: 1,
    ...(originRequestId ? { originRequestId } : {}),
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
    logger,
    processor: new StorageCleanupProcessor(
      repository,
      legacyStorageExecution(storage),
      logger,
    ),
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

  it("logs cleanup with its original HTTP request when available", async () => {
    const target = harness(true, false, "request-complete");
    await target.processor.runOnce();
    expect(target.logger.info).toHaveBeenCalledWith(
      expect.objectContaining({ originRequestId: "request-complete" }),
      "Storage cleanup completed",
    );
  });

  it("maps claimed cleanup origin and historical NULL without fabricating IDs", async () => {
    const execute = vi
      .fn()
      .mockResolvedValueOnce([
        {
          id: "new-cleanup",
          replacementId: "replacement",
          storageKey: "artifact",
          storageProfileId: legacyStorageProfileId,
          reason: "replacement_source_zip",
          attempts: 1,
          originRequestId: "request-complete",
        },
      ])
      .mockResolvedValueOnce([
        {
          id: "legacy-cleanup",
          replacementId: "replacement",
          storageKey: "artifact",
          storageProfileId: legacyStorageProfileId,
          reason: "replacement_source_zip",
          attempts: 1,
          originRequestId: null,
        },
      ]);
    const repository = new DrizzleStorageCleanupRepository({
      execute,
    } as never);
    expect(await repository.claimPending(1)).toMatchObject([
      { id: "new-cleanup", originRequestId: "request-complete" },
    ]);
    expect(await repository.claimPending(1)).toEqual([
      {
        id: "legacy-cleanup",
        replacementId: "replacement",
        storageKey: "artifact",
        storageProfileId: legacyStorageProfileId,
        reason: "replacement_source_zip",
        attempts: 1,
      },
    ]);
  });
});
