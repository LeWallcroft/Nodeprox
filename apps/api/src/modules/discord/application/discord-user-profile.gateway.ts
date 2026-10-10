export type DiscordUserProfile = {
  id: string;
  username: string;
  avatarUrl: string | null;
};

export interface DiscordUserProfileGateway {
  getProfile(discordId: string): Promise<DiscordUserProfile | null>;
}

export class DiscordUserProfileUnavailableError extends Error {
  constructor(readonly cause?: unknown) {
    super("discord-user-profile-unavailable");
    this.name = "DiscordUserProfileUnavailableError";
  }
}

export function isTrustedDiscordAvatarUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    return (
      parsed.protocol === "https:" &&
      parsed.hostname === "cdn.discordapp.com" &&
      (/^\/avatars\/\d{17,20}\/[A-Za-z0-9_]+\.(?:webp|png|gif|jpg)$/i.test(
        parsed.pathname,
      ) ||
        /^\/embed\/avatars\/\d+\.png$/i.test(parsed.pathname)) &&
      !parsed.username &&
      !parsed.password
    );
  } catch {
    return false;
  }
}
