import { describe, expect, it } from "vitest";
import { loadDiscordProfileSyncConfig } from "./index.js";

describe("Discord profile sync configuration", () => {
  it("uses operational defaults", () => {
    expect(loadDiscordProfileSyncConfig({})).toEqual({
      DISCORD_PROFILE_SYNC_INTERVAL_MS: 1_200_000,
      DISCORD_PROFILE_SYNC_BATCH_SIZE: 200,
      DISCORD_PROFILE_SYNC_CONCURRENCY: 5,
    });
  });

  it("validates interval, batch size and concurrency ranges", () => {
    expect(() =>
      loadDiscordProfileSyncConfig({
        DISCORD_PROFILE_SYNC_INTERVAL_MS: "899999",
      }),
    ).toThrow();
    expect(() =>
      loadDiscordProfileSyncConfig({ DISCORD_PROFILE_SYNC_BATCH_SIZE: "501" }),
    ).toThrow();
    expect(() =>
      loadDiscordProfileSyncConfig({ DISCORD_PROFILE_SYNC_CONCURRENCY: "17" }),
    ).toThrow();
  });
});
