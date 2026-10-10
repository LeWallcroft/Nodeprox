export interface DiscordLinkedUserPort {
  findDiscordId(userId: string): Promise<string | null>;
}
