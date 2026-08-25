import { describe, expect, it } from "vitest";
import { AuthorizationService } from "../../apps/api/src/modules/authorization/application/services/authorization.service.js";
import { DefaultAuthorizationPolicy } from "../../apps/api/src/modules/authorization/domain/policies/authorization.policy.js";
import { PERMISSIONS } from "../../apps/api/src/modules/authorization/domain/permissions.js";
import type { AuthorizationRoleRepository } from "../../apps/api/src/modules/authorization/application/ports/authorization.ports.js";

class FakeRoles implements AuthorizationRoleRepository {
  constructor(private readonly role: string | null) {}
  async findRoleByUserId(): Promise<string | null> {
    return this.role;
  }
}

const context = { userId: "user-1", sessionId: "session-1" };
const serviceFor = (roles: AuthorizationRoleRepository) =>
  new AuthorizationService(
    new DefaultAuthorizationPolicy(),
    roles,
    { append: async () => {} },
    { getHelperCooldownDays: async () => 7 },
  );

describe("M2-A authorization policy", () => {
  it("maps admin to every catalog permission through the policy layer", async () => {
    const policy = serviceFor(new FakeRoles("admin"));
    await expect(
      policy.authorize(context, PERMISSIONS.ADMIN_SYSTEM_MANAGE),
    ).resolves.toMatchObject({ allowed: true, role: "admin" });
  });

  it("allows gestor operational permissions but denies admin permissions", async () => {
    const policy = serviceFor(new FakeRoles("gestor"));
    await expect(
      policy.authorize(context, PERMISSIONS.SERIES_READ),
    ).resolves.toMatchObject({ allowed: true, role: "gestor" });
    await expect(
      policy.authorize(context, PERMISSIONS.ADMIN_USERS_MANAGE),
    ).resolves.toMatchObject({ allowed: false, reason: "permission-denied" });
  });

  it("keeps uploader capabilities bounded to the approved catalog", async () => {
    const policy = serviceFor(new FakeRoles("uploader"));
    await expect(
      policy.authorize(context, PERMISSIONS.APPROVALS_CONSUME),
    ).resolves.toMatchObject({ allowed: false, reason: "permission-denied" });
    await expect(
      policy.authorize(context, PERMISSIONS.ADMIN_API_MANAGE),
    ).resolves.toMatchObject({ allowed: false, reason: "permission-denied" });
  });

  it.each([
    ["unknown-role", "unknown-role"],
    ["missing-role", null],
  ])("denies %s", async (_label, role) => {
    const policy = serviceFor(new FakeRoles(role));
    await expect(
      policy.authorize(context, PERMISSIONS.SERIES_READ),
    ).resolves.toMatchObject({ allowed: false, reason: "unknown-role" });
  });

  it("denies unauthenticated, unknown, and resource-scoped uncertainty", async () => {
    const policy = serviceFor(new FakeRoles("uploader"));
    await expect(
      policy.authorize({ userId: "", sessionId: "" }, PERMISSIONS.SERIES_READ),
    ).resolves.toMatchObject({ allowed: false, reason: "unauthenticated" });
    await expect(
      policy.authorize(context, "not-a-permission" as never),
    ).resolves.toMatchObject({ allowed: false, reason: "unknown-permission" });
    await expect(
      policy.authorize(context, PERMISSIONS.SERIES_EDIT, {
        type: "series",
        id: "series-1",
      }),
    ).resolves.toMatchObject({
      allowed: false,
      reason: "permission-denied",
    });
  });

  it("fails closed when role resolution fails", async () => {
    const roles: AuthorizationRoleRepository = {
      findRoleByUserId: async () => {
        throw new Error("database unavailable");
      },
    };
    const policy = serviceFor(roles);
    await expect(
      policy.authorize(context, PERMISSIONS.SERIES_READ),
    ).resolves.toMatchObject({ allowed: false, reason: "policy-error" });
  });

  it.each([
    ["missing", undefined],
    ["invalid type", "7"],
    ["non-integer", 1.5],
    ["negative", -1],
  ])("fails closed for %s cooldown configuration", async (_label, value) => {
    const service = new AuthorizationService(
      new DefaultAuthorizationPolicy(),
      new FakeRoles("uploader"),
      { append: async () => {} },
      {
        getHelperCooldownDays: async () => value as never,
      },
    );
    await expect(service.getHelperCooldownDecision()).resolves.toEqual({
      allowed: false,
      reason: "policy-error",
    });
  });
});
