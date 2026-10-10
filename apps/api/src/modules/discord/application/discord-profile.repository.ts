export interface DiscordProfileRepository {
  listLinked(input: {
    afterId?: string;
    limit: number;
  }): Promise<readonly { userId: string; discordId: string }[]>;

  updateDiscordProfile(input: {
    userId: string;
    expectedDiscordId: string;
    discordUsername: string;
    avatarUrl: string | null;
  }): Promise<boolean>;
}
