import { describe, expect, it, vi } from "vitest";
import { SyncDiscordUserProfilesService } from "./sync-discord-user-profiles.service.js";

describe("SyncDiscordUserProfilesService", () => {
  it("continues after an unavailable profile and guards updates through the repository", async () => {
    const repository = {
      listLinked: vi.fn().mockResolvedValue([
        { userId: "u1", discordId: "12345678901234567" },
        { userId: "u2", discordId: "22345678901234567" },
      ]),
      updateDiscordProfile: vi.fn().mockResolvedValue("changed"),
      getSyncStatus: vi.fn(),
    };
    const profiles = {
      getProfile: vi
        .fn()
        .mockRejectedValueOnce(new Error("temporary"))
        .mockResolvedValueOnce({
          id: "22345678901234567",
          username: "updated_name",
          avatarUrl: null,
        }),
    };
    const service = new SyncDiscordUserProfilesService(repository, profiles);
    const result = await service.syncBatch({ limit: 2, concurrency: 1 });
    expect(result).toMatchObject({
      processed: 2,
      changed: 1,
      refreshed: 0,
      failed: 1,
    });
    expect(result.failures[0]).toMatchObject({ userId: "u1", code: "Error" });
    expect(repository.updateDiscordProfile).toHaveBeenCalledWith({
      userId: "u2",
      expectedDiscordId: "22345678901234567",
      discordUsername: "updated_name",
      avatarUrl: null,
      syncedAt: expect.any(Date),
    });
  });

  it("skips an unavailable Discord user without changing the linked projection", async () => {
    const repository = {
      listLinked: vi
        .fn()
        .mockResolvedValue([{ userId: "u1", discordId: "12345678901234567" }]),
      updateDiscordProfile: vi.fn(),
      getSyncStatus: vi.fn(),
    };
    const profiles = { getProfile: vi.fn().mockResolvedValue(null) };
    const result = await new SyncDiscordUserProfilesService(
      repository,
      profiles,
    ).syncBatch({ limit: 10, concurrency: 1 });

    expect(result).toMatchObject({ processed: 1, skipped: 1, failed: 0 });
    expect(repository.updateDiscordProfile).not.toHaveBeenCalled();
  });

  it("passes stale cutoff to repository selection", async () => {
    const repository = {
      listLinked: vi.fn().mockResolvedValue([]),
      updateDiscordProfile: vi.fn(),
      getSyncStatus: vi.fn(),
    };
    const result = await new SyncDiscordUserProfilesService(repository, {
      getProfile: vi.fn(),
    }).syncBatch({
      limit: 10,
      concurrency: 1,
      staleBefore: new Date("2026-01-01T00:00:00.000Z"),
    });

    expect(repository.listLinked).toHaveBeenCalledWith(
      expect.objectContaining({
        staleBefore: new Date("2026-01-01T00:00:00.000Z"),
      }),
    );
    expect(result.processed).toBe(0);
  });
});
