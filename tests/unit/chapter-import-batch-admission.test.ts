import { describe, expect, it, vi } from "vitest";
import {
  ChapterImportBatchService,
  IMPORT_BATCH_TOTAL_SIZE_LIMIT,
  type ImportBatchLimitError,
} from "../../apps/api/src/modules/ingestion/application/chapter-import-batch.service.js";
import { ChapterTargetResolver } from "../../apps/api/src/modules/ingestion/application/chapter-target.resolver.js";
import type {
  ImportBatchRepositoryPort,
  ImportChapterCreatePort,
  ImportChapterLookupPort,
  ImportItemInput,
  ImportSeriesAccessPort,
  ImportUploadPort,
} from "../../apps/api/src/modules/ingestion/application/ports.js";

const actor = { userId: "actor-1", sessionId: "session-1" };
const ITEM_LIMIT = 512 * 1024 * 1024;

describe("ChapterImportBatchService admission limits", () => {
  it("accepts a batch whose total size is exactly 3 GiB", async () => {
    const { service, reserve } = createService();
    const items = candidates(6, ITEM_LIMIT);

    const result = await service.create({ actor, seriesId: "series-1", items });

    expect(result.items).toHaveLength(6);
    expect(reserve).toHaveBeenCalledOnce();
  });

  it("rejects a batch over 3 GiB before reserving capacity", async () => {
    const { service, reserve } = createService();
    const items = candidates(7, ITEM_LIMIT);

    await expect(
      service.create({ actor, seriesId: "series-1", items }),
    ).rejects.toMatchObject({
      reason: "bulk-batch-size-limit",
    } satisfies Partial<ImportBatchLimitError>);
    expect(reserve).not.toHaveBeenCalled();
  });

  it("keeps the approved total limit at exactly 3 GiB", () => {
    expect(IMPORT_BATCH_TOTAL_SIZE_LIMIT).toBe(3 * 1024 * 1024 * 1024);
  });

  it("releases pending admission capacity when target resolution aborts the batch", async () => {
    const { service, failReservation } = createService({
      findTarget: async () => {
        throw new Error("target-read-failed");
      },
    });

    await expect(
      service.create({
        actor,
        seriesId: "series-1",
        items: candidates(2, 1),
      }),
    ).rejects.toThrow("target-read-failed");
    expect(failReservation).toHaveBeenCalledWith({
      batchId: expect.any(String),
      errorCode: "import-batch-reservation-failed",
    });
  });
});

function candidates(count: number, sizeBytes: number): ImportItemInput[] {
  return Array.from({ length: count }, (_, index) => ({
    clientId: `client-${index}`,
    chapterNumber: index,
    filename: `${index}.zip`,
    contentType: "application/zip",
    sizeBytes,
  }));
}

function createService(options?: {
  findTarget?: ImportChapterLookupPort["findTarget"];
}) {
  const reserve = vi.fn<ImportBatchRepositoryPort["reserve"]>(
    async (input) => ({
      outcome: "reserved",
      items: input.items.map((item, index) => ({
        itemId: `item-${index}`,
        clientId: item.clientId,
      })),
    }),
  );
  const failReservation = vi.fn(async () => undefined);
  const repository: ImportBatchRepositoryPort = {
    reserve,
    failReservation,
    attachUpload: async () => true,
    updateResolution: async () => true,
    failItem: async () => undefined,
    find: async () => null,
    claimResubmission: async () => ({ outcome: "not-found" }),
  };
  const access: ImportSeriesAccessPort = { check: async () => "allowed" };
  const lookup: ImportChapterLookupPort = {
    findTarget: options?.findTarget ?? (async () => null),
  };
  const create: ImportChapterCreatePort = {
    create: async (input) => ({
      outcome: "created",
      chapterId: `chapter-${input.chapterNumber}`,
    }),
  };
  const uploads: ImportUploadPort = {
    initiate: async (input) => ({
      outcome: "initiated",
      uploadId: `upload-${input.chapterId}`,
      transfer: {
        mode: "single",
        method: "PUT",
        url: "https://upload.invalid",
        headers: {},
        expiresAt: "2026-09-02T00:00:00.000Z",
      },
    }),
    abort: async () => undefined,
  };
  return {
    reserve,
    failReservation,
    service: new ChapterImportBatchService(
      repository,
      access,
      new ChapterTargetResolver(lookup, create),
      uploads,
      ITEM_LIMIT,
    ),
  };
}
