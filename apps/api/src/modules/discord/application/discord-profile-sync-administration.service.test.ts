import { describe, expect, it, vi } from "vitest";
import { PERMISSIONS } from "../../authorization/domain/permissions.js";
import { DiscordProfileSyncAdministrationService } from "./discord-profile-sync-administration.service.js";

function setup(
  triggerResult:
    | { accepted: true }
    | { accepted: false; reason: "already-running" },
) {
  const authorization = {
    authorize: vi.fn().mockResolvedValue({ allowed: true }),
    recordSensitiveEvent: vi.fn().mockResolvedValue(undefined),
  };
  const repository = {
    getSyncStatus: vi.fn().mockResolvedValue({
      linkedUsers: 4,
      missingAvatar: 1,
      staleProfiles: 2,
      oldestSyncedAt: null,
    }),
  };
  const coordinator = {
    isRunningDistributed: vi.fn().mockResolvedValue(false),
    trigger: vi.fn().mockResolvedValue(triggerResult),
  };
  return {
    service: new DiscordProfileSyncAdministrationService(
      authorization as never,
      repository as never,
      coordinator as never,
      3_600_000,
    ),
    authorization,
    repository,
    coordinator,
  };
}

const context = { userId: "admin-user", sessionId: "session" };

describe("DiscordProfileSyncAdministrationService", () => {
  it("authorizes through the Discord integration capability", async () => {
    const { service, authorization } = setup({ accepted: true });
    await service.getStatus(context);
    expect(authorization.authorize).toHaveBeenCalledWith(
      context,
      PERMISSIONS.DISCORD_INTEGRATION_CONFIGURE,
    );
    expect(authorization.authorize).not.toHaveBeenCalledWith(
      context,
      PERMISSIONS.ADMIN_SYSTEM_MANAGE,
    );
  });

  it("audits an accepted trigger as success after acceptance", async () => {
    const { service, authorization, coordinator } = setup({ accepted: true });
    await service.triggerSync(context, "http-request-id");
    const triggerOrder = coordinator.trigger.mock.invocationCallOrder[0] ?? -1;
    const auditOrder =
      authorization.recordSensitiveEvent.mock.invocationCallOrder[0] ?? -1;
    expect(triggerOrder).toBeGreaterThan(0);
    expect(auditOrder).toBeGreaterThan(triggerOrder);
    expect(authorization.recordSensitiveEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "discord.profile_sync.triggered",
        result: "success",
        requestId: "http-request-id",
      }),
    );
  });

  it("audits an already-running trigger as rejected, never success", async () => {
    const { service, authorization } = setup({
      accepted: false,
      reason: "already-running",
    });
    await service.triggerSync(context, "http-request-id");
    expect(authorization.recordSensitiveEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        result: "rejected",
        reasonCode: "already-running",
      }),
    );
    expect(authorization.recordSensitiveEvent).not.toHaveBeenCalledWith(
      expect.objectContaining({ result: "success" }),
    );
  });
});
