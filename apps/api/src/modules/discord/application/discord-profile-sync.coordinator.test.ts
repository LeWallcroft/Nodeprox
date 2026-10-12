import { describe, expect, it, vi } from "vitest";
import { DiscordProfileSyncCoordinator } from "./discord-profile-sync.coordinator.js";

const options = { batchSize: 200, concurrency: 5 };
const summary = {
  processed: 1,
  changed: 1,
  refreshed: 0,
  skipped: 0,
  failed: 0,
  startedAt: new Date("2026-10-12T00:00:00Z"),
  completedAt: new Date("2026-10-12T00:00:01Z"),
};

describe("DiscordProfileSyncCoordinator", () => {
  it("returns immediately, rejects local overlap and releases the lease", async () => {
    let finish!: (value: typeof summary) => void;
    const runner = {
      run: vi.fn(
        () => new Promise<typeof summary>((resolve) => (finish = resolve)),
      ),
    };
    const leaseHandle = { release: vi.fn().mockResolvedValue(undefined) };
    const lease = { tryAcquire: vi.fn().mockResolvedValue(leaseHandle) };
    const coordinator = new DiscordProfileSyncCoordinator(
      lease,
      runner as never,
      options,
    );

    await expect(coordinator.trigger({ mode: "force" })).resolves.toEqual({
      accepted: true,
    });
    expect(coordinator.isRunning()).toBe(true);
    await expect(
      coordinator.trigger({ mode: "stale", staleBefore: new Date() }),
    ).resolves.toEqual({
      accepted: false,
      reason: "already-running",
    });
    expect(lease.tryAcquire).toHaveBeenCalledTimes(1);
    finish(summary);
    await coordinator.waitForIdle();
    expect(leaseHandle.release).toHaveBeenCalledTimes(1);
    expect(coordinator.isRunning()).toBe(false);
  });

  it("does not start when another process holds the advisory lease", async () => {
    const runner = { run: vi.fn() };
    const coordinator = new DiscordProfileSyncCoordinator(
      { tryAcquire: vi.fn().mockResolvedValue(null) },
      runner as never,
      options,
    );
    await expect(coordinator.trigger({ mode: "force" })).resolves.toEqual({
      accepted: false,
      reason: "already-running",
    });
    expect(runner.run).not.toHaveBeenCalled();
    expect(coordinator.isRunning()).toBe(false);
  });

  it("releases the lease and clears local state after runner failure", async () => {
    const release = vi.fn().mockResolvedValue(undefined);
    const coordinator = new DiscordProfileSyncCoordinator(
      { tryAcquire: vi.fn().mockResolvedValue({ release }) },
      { run: vi.fn().mockRejectedValue(new Error("safe-to-hide")) } as never,
      options,
    );
    await coordinator.trigger({ mode: "force" });
    await coordinator.waitForIdle();
    expect(release).toHaveBeenCalledOnce();
    expect(coordinator.isRunning()).toBe(false);
  });
});
