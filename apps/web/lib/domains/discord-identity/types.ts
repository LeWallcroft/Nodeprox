export type DiscordLinkCodeResponse = {
  code: string;
  expiresAt: string;
  expiresInSeconds: number;
};

export type DiscordLinkStatus =
  | { state: "unlinked" }
  | { state: "pending"; expiresAt: string }
  | {
      state: "linked";
      discordId: string;
      discordUsername: string | null;
      linkedAt: string | null;
    };
