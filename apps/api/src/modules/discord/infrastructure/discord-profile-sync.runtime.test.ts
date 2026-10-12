import { afterEach, describe, expect, it, vi } from "vitest";
import { DiscordProfileSyncRuntime } from "./discord-profile-sync.runtime.js";

const config = {
  DISCORD_PROFILE_SYNC_INTERVAL_MS: 900_000,
  DISCORD_PROFILE_SYNC_BATCH_SIZE: 200,
  DISCORD_PROFILE_SYNC_CONCURRENCY: 5,
};
const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };

afterEach(() => vi.useRealTimers());

describe("DiscordProfileSyncRuntime", () => {
  it("delays first run, triggers stale mode, and reschedules after completion", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-10-12T01:00:00Z"));
    const coordinator = {
      trigger: vi.fn().mockResolvedValue({ accepted: true }),
      waitForIdle: vi.fn().mockResolvedValue(undefined),
    };
    const runtime = new DiscordProfileSyncRuntime(
      coordinator as never,
      config,
      logger,
    );
    runtime.start();
    await vi.advanceTimersByTimeAsync(4 * 60_000 + 59_000);
    expect(coordinator.trigger).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1_000);
    expect(coordinator.trigger).toHaveBeenCalledWith({
      mode: "stale",
      staleBefore: new Date("2026-10-12T00:50:00Z"),
    });
    await vi.advanceTimersByTimeAsync(899_999);
    expect(coordinator.trigger).toHaveBeenCalledOnce();
    await vi.advanceTimersByTimeAsync(1);
    expect(coordinator.trigger).toHaveBeenCalledTimes(2);
    await runtime.stop();
  });

  it("cancels future runs and waits for an active run during stop", async () => {
    vi.useFakeTimers();
    let finish!: () => void;
    const idle = new Promise<void>((resolve) => (finish = resolve));
    const coordinator = {
      trigger: vi.fn().mockResolvedValue({ accepted: true }),
      waitForIdle: vi.fn(() => idle),
    };
    const runtime = new DiscordProfileSyncRuntime(
      coordinator as never,
      config,
      logger,
    );
    runtime.start();
    vi.advanceTimersByTime(5 * 60_000);
    await Promise.resolve();
    await Promise.resolve();
    expect(coordinator.waitForIdle).toHaveBeenCalled();
    const stopping = runtime.stop();
    finish();
    await stopping;
    await vi.advanceTimersByTimeAsync(
      config.DISCORD_PROFILE_SYNC_INTERVAL_MS * 2,
    );
    expect(coordinator.trigger).toHaveBeenCalledOnce();
  });
});
