import {
  type DiscordGuildRoleVerificationResult,
  DiscordGuildRoleVerificationUnavailableError,
  type DiscordGuildRoleVerifier,
} from "../application/discord-guild-role-verifier.js";

export class DiscordBotGuildRoleVerifier implements DiscordGuildRoleVerifier {
  constructor(
    private readonly baseUrl: string,
    private readonly internalToken: string,
    private readonly fetcher: typeof fetch = fetch,
  ) {}

  async verifyRoles(input: {
    guildId: string;
    roleIds: readonly string[];
  }): Promise<DiscordGuildRoleVerificationResult> {
    let response: Response;
    try {
      response = await this.fetcher(
        new URL("/internal/discord/guild-roles/verify", this.baseUrl),
        {
          method: "POST",
          headers: {
            authorization: `Bearer ${this.internalToken}`,
            "content-type": "application/json",
          },
          body: JSON.stringify(input),
          signal: AbortSignal.timeout(5_000),
        },
      );
    } catch {
      throw new DiscordGuildRoleVerificationUnavailableError();
    }
    if (!response.ok) throw new DiscordGuildRoleVerificationUnavailableError();
    const value = (await response
      .json()
      .catch(() => null)) as DiscordGuildRoleVerificationResult | null;
    if (
      !value ||
      value.guildId !== input.guildId ||
      !Array.isArray(value.roles) ||
      value.roles.length !== input.roleIds.length
    )
      throw new DiscordGuildRoleVerificationUnavailableError();
    return value;
  }
}
