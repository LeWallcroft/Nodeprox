import { describe, expect, it, vi } from "vitest";
import { SyncDiscordUserProfilesService } from "./sync-discord-user-profiles.service.js";

describe("SyncDiscordUserProfilesService", () => {
  it("continues after an unavailable profile and guards updates through the repository", async () => {
    const repository = {
      listLinked: vi.fn().mockResolvedValue([
        { userId: "u1", discordId: "12345678901234567" },
        { userId: "u2", discordId: "22345678901234567" },
      ]),
      updateDiscordProfile: vi.fn().mockResolvedValue(true),
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
    expect(result).toMatchObject({ processed: 2, updated: 1, failed: 1 });
    expect(result.failures[0]).toMatchObject({ userId: "u1", code: "Error" });
    expect(repository.updateDiscordProfile).toHaveBeenCalledWith({
      userId: "u2",
      expectedDiscordId: "22345678901234567",
      discordUsername: "updated_name",
      avatarUrl: null,
    });
  });
});
