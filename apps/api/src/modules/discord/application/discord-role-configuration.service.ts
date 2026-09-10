import type { AuthorizationService } from "../../authorization/application/services/authorization.service.js";
import type { AuthorizationContext } from "../../authorization/domain/authorization.types.js";
import { PERMISSIONS } from "../../authorization/domain/permissions.js";
import {
  type DiscordAuthorizedRoleReadModel,
  discordBotCapabilities,
  mapDiscordAuthorizedRoleWrite,
} from "./discord-authorization-policy.js";
import {
  type DiscordGuildRoleVerificationResult,
  DiscordGuildRoleVerificationUnavailableError,
  type DiscordGuildRoleVerifier,
} from "./discord-guild-role-verifier.js";

export type DiscordAuthorizedRolesResponse = {
  guildId: string;
  roles: DiscordAuthorizedRoleReadModel[];
};

export type DiscordAuthorizedRoleConfigurationRepository = {
  list(): Promise<DiscordAuthorizedRolesResponse | null>;
  replace(input: {
    actorUserId: string;
    requestId?: string;
    roles: readonly ReturnType<typeof mapDiscordAuthorizedRoleWrite>[];
  }): Promise<DiscordAuthorizedRolesResponse | null>;
};

export class DiscordRoleConfigurationForbiddenError extends Error {}
export class DiscordRoleConfigurationValidationError extends Error {}
export class DiscordRoleConfigurationUnavailableError extends Error {}

const snowflake = /^\d{17,20}$/;

export class DiscordRoleConfigurationService {
  constructor(
    private readonly repository: DiscordAuthorizedRoleConfigurationRepository,
    private readonly authorization: AuthorizationService,
    private readonly verifier: DiscordGuildRoleVerifier,
  ) {}

  async listAuthorizedRoles(
    actor: AuthorizationContext,
  ): Promise<DiscordAuthorizedRolesResponse> {
    await this.requireConfigurationAccess(actor);
    const result = await this.repository.list();
    if (!result) throw new DiscordRoleConfigurationValidationError();
    return result;
  }

  async replaceAuthorizedRoles(
    actor: AuthorizationContext,
    roles: readonly DiscordAuthorizedRoleReadModel[],
    requestId?: string,
  ): Promise<DiscordAuthorizedRolesResponse> {
    await this.requireConfigurationAccess(actor);
    this.validateRoles(roles);
    const current = await this.repository.list();
    if (!current) throw new DiscordRoleConfigurationValidationError();
    let verified: DiscordGuildRoleVerificationResult;
    try {
      verified = await this.verifier.verifyRoles({
        guildId: current.guildId,
        roleIds: roles.map((role) => role.roleId),
      });
    } catch (error) {
      if (error instanceof DiscordGuildRoleVerificationUnavailableError)
        throw new DiscordRoleConfigurationUnavailableError();
      throw error;
    }
    if (
      verified.guildId !== current.guildId ||
      verified.roles.length !== roles.length ||
      verified.roles.some((role) => !role.exists)
    )
      throw new DiscordRoleConfigurationValidationError();
    const updated = await this.repository.replace({
      actorUserId: actor.userId,
      ...(requestId ? { requestId } : {}),
      roles: roles.map(mapDiscordAuthorizedRoleWrite),
    });
    if (!updated) throw new DiscordRoleConfigurationValidationError();
    return updated;
  }

  private async requireConfigurationAccess(actor: AuthorizationContext) {
    const decision = await this.authorization.authorize(
      actor,
      PERMISSIONS.DISCORD_INTEGRATION_CONFIGURE,
    );
    if (!decision.allowed) throw new DiscordRoleConfigurationForbiddenError();
  }

  private validateRoles(roles: readonly DiscordAuthorizedRoleReadModel[]) {
    const seenRoles = new Set<string>();
    for (const role of roles) {
      if (!snowflake.test(role.roleId) || seenRoles.has(role.roleId))
        throw new DiscordRoleConfigurationValidationError();
      seenRoles.add(role.roleId);
      const capabilities = new Set(role.capabilities);
      if (
        capabilities.size !== role.capabilities.length ||
        role.capabilities.some(
          (capability) =>
            !(discordBotCapabilities as readonly string[]).includes(capability),
        )
      )
        throw new DiscordRoleConfigurationValidationError();
    }
  }
}
