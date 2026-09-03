import { describe, expect, it, vi } from "vitest";
import {
  MAX_DIRECT_UPLOAD_CONCURRENCY,
  canEnqueueDirectUpload,
  mediaWarningLabel,
  runPool,
  safeBulkUploadConcurrency,
  sanitizeTrackedBatches,
} from "./orchestration";

describe("bulk upload orchestration", () => {
  it("never runs more than three direct uploads concurrently", async () => {
    let active = 0;
    let maximum = 0;
    const releases: (() => void)[] = [];
    const jobs = Array.from({ length: 7 }, () => async () => {
      active += 1;
      maximum = Math.max(maximum, active);
      await new Promise<void>((resolve) => releases.push(resolve));
      active -= 1;
    });
    const running = runPool(jobs);
    await vi.waitFor(() => expect(active).toBe(MAX_DIRECT_UPLOAD_CONCURRENCY));
    while (releases.length > 0 || active > 0) {
      releases.shift()?.();
      await Promise.resolve();
    }
    await running;
    expect(maximum).toBe(3);
  });

  it("keeps successful items intact when one item fails and is retried", async () => {
    const uploads = new Map<string, number>();
    const statuses = new Map<string, "ready" | "failed">();
    const upload = async (id: string, fail = false) => {
      uploads.set(id, (uploads.get(id) ?? 0) + 1);
      statuses.set(id, fail ? "failed" : "ready");
    };
    await runPool([
      () => upload("25"),
      () => upload("26", true),
      () => upload("30"),
    ]);
    await upload("26");
    expect(Object.fromEntries(uploads)).toEqual({ 25: 1, 26: 2, 30: 1 });
    expect(Object.fromEntries(statuses)).toEqual({
      25: "ready",
      26: "ready",
      30: "ready",
    });
  });

  it("renders media warnings without treating them as rejection", () => {
    expect(
      mediaWarningLabel({
        code: "wide-image",
        filename: "01.jpg",
        width: 5000,
      }),
    ).toContain("01.jpg");
  });

  it.each([
    [undefined, 3],
    [1, 1],
    [5, 5],
    [0, 1],
    [6, 5],
    [2.5, 3],
  ])(
    "keeps browser concurrency within the approved range",
    (value, expected) => {
      expect(safeBulkUploadConcurrency(value)).toBe(expected);
    },
  );

  it.each([1, 3, 5])(
    "observes at most %i simultaneous direct uploads",
    async (concurrency) => {
      let active = 0;
      let maximum = 0;
      const jobs = Array.from({ length: 12 }, () => async () => {
        active += 1;
        maximum = Math.max(maximum, active);
        await Promise.resolve();
        active -= 1;
      });
      await runPool(jobs, concurrency);
      expect(maximum).toBe(concurrency);
    },
  );

  it("rehydrates only minimal queue metadata and drops secrets or presigned URLs", () => {
    expect(
      sanitizeTrackedBatches(
        [
          {
            batchId: "batch-1",
            seriesId: "series-1",
            seriesTitle: "Raven",
            trackedAt: 100,
            uploadUrl: "https://presigned.example/secret",
            authorization: "Bearer secret",
          },
        ],
        0,
      ),
    ).toEqual([
      {
        batchId: "batch-1",
        seriesId: "series-1",
        seriesTitle: "Raven",
        trackedAt: 100,
      },
    ]);
  });

  it("drops stale and malformed tracked batches during rehydration", () => {
    expect(
      sanitizeTrackedBatches(
        [
          {
            batchId: "old",
            seriesId: "series-1",
            seriesTitle: "Old",
            trackedAt: 99,
          },
          { batchId: "invalid" },
        ],
        100,
      ),
    ).toEqual([]);
  });

  it.each(["created", "reused"])(
    "enqueues a transferable %s target",
    (resolution) => {
      expect(
        canEnqueueDirectUpload({
          status: "uploading",
          resolution,
          hasTransfer: true,
        }),
      ).toBe(true);
    },
  );

  it("never enqueues a conflict or a stale item without a transfer grant", () => {
    expect(
      canEnqueueDirectUpload({
        status: "failed",
        resolution: "conflict",
        hasTransfer: false,
      }),
    ).toBe(false);
    expect(
      canEnqueueDirectUpload({
        status: "uploading",
        resolution: "reused",
        hasTransfer: false,
      }),
    ).toBe(false);
  });
});
