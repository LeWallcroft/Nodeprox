import { describe, expect, it, vi } from "vitest";
import type { DiscordAuthorizedRoleReadModel } from "./discord-authorization-policy.js";
import { DiscordGuildRoleVerificationUnavailableError } from "./discord-guild-role-verifier.js";
import {
  DiscordRoleConfigurationForbiddenError,
  DiscordRoleConfigurationService,
  DiscordRoleConfigurationUnavailableError,
  DiscordRoleConfigurationValidationError,
} from "./discord-role-configuration.service.js";

const roleId = "12345678901234567";
const actor = { userId: "user", sessionId: "session" };
const role: DiscordAuthorizedRoleReadModel = {
  roleId,
  capabilities: ["series_grant.issue"],
};

function setup(input?: {
  allowed?: boolean;
  exists?: boolean;
  unavailable?: boolean;
}) {
  const repository = {
    list: vi
      .fn()
      .mockResolvedValue({ guildId: "22345678901234567", roles: [] }),
    replace: vi
      .fn()
      .mockResolvedValue({ guildId: "22345678901234567", roles: [role] }),
  };
  const authorization = {
    authorize: vi.fn().mockResolvedValue({ allowed: input?.allowed ?? true }),
  };
  const verifier = {
    verifyRoles: vi.fn().mockImplementation(() => {
      if (input?.unavailable)
        throw new DiscordGuildRoleVerificationUnavailableError();
      return Promise.resolve({
        guildId: "22345678901234567",
        roles: [{ roleId, exists: input?.exists ?? true }],
      });
    }),
  };
  return {
    repository,
    authorization,
    verifier,
    service: new DiscordRoleConfigurationService(
      repository,
      authorization as never,
      verifier,
    ),
  };
}

describe("DiscordRoleConfigurationService", () => {
  it("authorizes, verifies roles, then replaces the full configuration", async () => {
    const { service, verifier, repository } = setup();
    await expect(
      service.replaceAuthorizedRoles(actor, [role], "request"),
    ).resolves.toEqual({
      guildId: "22345678901234567",
      roles: [role],
    });
    expect(verifier.verifyRoles).toHaveBeenCalledWith({
      guildId: "22345678901234567",
      roleIds: [roleId],
    });
    expect(repository.replace).toHaveBeenCalledOnce();
  });

  it("rejects unauthorized actors without invoking the verifier", async () => {
    const { service, verifier } = setup({ allowed: false });
    await expect(service.listAuthorizedRoles(actor)).rejects.toBeInstanceOf(
      DiscordRoleConfigurationForbiddenError,
    );
    expect(verifier.verifyRoles).not.toHaveBeenCalled();
  });

  it("fails closed when Discord cannot validate the submitted roles", async () => {
    const { service, repository } = setup({ unavailable: true });
    await expect(
      service.replaceAuthorizedRoles(actor, [role]),
    ).rejects.toBeInstanceOf(DiscordRoleConfigurationUnavailableError);
    expect(repository.replace).not.toHaveBeenCalled();
  });

  it("rejects a nonexistent Discord role without persistence", async () => {
    const { service, repository } = setup({ exists: false });
    await expect(
      service.replaceAuthorizedRoles(actor, [role]),
    ).rejects.toBeInstanceOf(DiscordRoleConfigurationValidationError);
    expect(repository.replace).not.toHaveBeenCalled();
  });
});
