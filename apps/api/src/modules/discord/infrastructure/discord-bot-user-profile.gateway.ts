import {
  DiscordUserProfileUnavailableError,
  isTrustedDiscordAvatarUrl,
  type DiscordUserProfile,
  type DiscordUserProfileGateway,
} from "../application/discord-user-profile.gateway.js";

const snowflake = /^\d{17,20}$/;

export class DiscordBotUserProfileGateway implements DiscordUserProfileGateway {
  constructor(
    private readonly baseUrl: string,
    private readonly internalToken: string,
    private readonly fetcher: typeof fetch = fetch,
  ) {}

  async getProfile(discordId: string): Promise<DiscordUserProfile | null> {
    if (!snowflake.test(discordId))
      throw new DiscordUserProfileUnavailableError();
    let response: Response;
    try {
      response = await this.fetcher(
        new URL(`/internal/discord/users/${discordId}/profile`, this.baseUrl),
        {
          headers: { authorization: `Bearer ${this.internalToken}` },
          signal: AbortSignal.timeout(5_000),
        },
      );
    } catch (error) {
      throw new DiscordUserProfileUnavailableError(error);
    }
    if (response.status === 404) return null;
    if (!response.ok) throw new DiscordUserProfileUnavailableError();
    const payload: unknown = await response.json().catch(() => null);
    if (!payload || typeof payload !== "object")
      throw new DiscordUserProfileUnavailableError();
    const profile = payload as Record<string, unknown>;
    if (
      Object.keys(profile).length !== 3 ||
      !["id", "username", "avatarUrl"].every((key) => key in profile) ||
      profile.id !== discordId ||
      typeof profile.username !== "string" ||
      !profile.username.trim() ||
      (profile.avatarUrl !== null &&
        (typeof profile.avatarUrl !== "string" ||
          !isTrustedDiscordAvatarUrl(profile.avatarUrl)))
    )
      throw new DiscordUserProfileUnavailableError();
    return {
      id: profile.id,
      username: profile.username,
      avatarUrl: profile.avatarUrl as string | null,
    };
  }
}
