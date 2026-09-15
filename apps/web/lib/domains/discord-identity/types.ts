export type DiscordLinkCodeResponse = {
  code: string;
  expiresAt: string;
  expiresInSeconds: number;
};

export type DiscordLinkStatus =
  | { state: "unlinked" }
  | { state: "pending"; expiresAt: string }
  | { state: "linked"; linkedAt: string | null };
