import { describe, expect, it, vi } from "vitest";
import { DiscordProfileSyncRunner } from "./discord-profile-sync.runner.js";

describe("DiscordProfileSyncRunner", () => {
  it("paginates through more than one batch and reports separate outcomes", async () => {
    const syncBatch = vi
      .fn()
      .mockResolvedValueOnce({
        processed: 2,
        changed: 1,
        refreshed: 1,
        skipped: 0,
        failed: 0,
        nextCursor: "user-2",
        failures: [],
      })
      .mockResolvedValueOnce({
        processed: 1,
        changed: 0,
        refreshed: 0,
        skipped: 1,
        failed: 0,
        nextCursor: null,
        failures: [],
      });
    const clock = vi
      .fn<() => Date>()
      .mockReturnValueOnce(new Date("2026-10-12T00:00:00Z"))
      .mockReturnValueOnce(new Date("2026-10-12T00:00:02Z"));
    const runner = new DiscordProfileSyncRunner({ syncBatch } as never, clock);

    const summary = await runner.run({
      mode: "stale",
      staleBefore: new Date("2026-10-11T23:00:00Z"),
      batchSize: 2,
      concurrency: 5,
    });

    expect(summary).toMatchObject({
      processed: 3,
      changed: 1,
      refreshed: 1,
      skipped: 1,
      failed: 0,
    });
    expect(syncBatch).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        afterId: "user-2",
        staleBefore: new Date("2026-10-11T23:00:00Z"),
      }),
    );
  });

  it("force mode enumerates linked users without passing a stale cutoff", async () => {
    const syncBatch = vi.fn().mockResolvedValue({
      processed: 0,
      changed: 0,
      refreshed: 0,
      skipped: 0,
      failed: 0,
      nextCursor: null,
      failures: [],
    });
    const runner = new DiscordProfileSyncRunner({ syncBatch } as never);
    await runner.run({ mode: "force", batchSize: 200, concurrency: 5 });
    expect(syncBatch).toHaveBeenCalledWith({ limit: 200, concurrency: 5 });
  });
});
