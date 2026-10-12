export interface DiscordProfileRepository {
  listLinked(input: {
    afterId?: string;
    limit: number;
    staleBefore?: Date;
  }): Promise<readonly { userId: string; discordId: string }[]>;

  updateDiscordProfile(input: {
    userId: string;
    expectedDiscordId: string;
    discordUsername: string;
    avatarUrl: string | null;
    syncedAt: Date;
  }): Promise<"changed" | "refreshed" | "link-changed">;

  getSyncStatus(input: { staleBefore: Date }): Promise<{
    linkedUsers: number;
    missingAvatar: number;
    staleProfiles: number;
    oldestSyncedAt: Date | null;
  }>;
}
