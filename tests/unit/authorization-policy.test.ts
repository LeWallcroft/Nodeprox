import { describe, expect, it, vi } from "vitest";
import { AuthorizationService } from "../../apps/api/src/modules/authorization/application/services/authorization.service.js";
import { DefaultAuthorizationPolicy } from "../../apps/api/src/modules/authorization/domain/policies/authorization.policy.js";
import { PERMISSIONS } from "../../apps/api/src/modules/authorization/domain/permissions.js";
import type { AuthorizationRoleRepository } from "../../apps/api/src/modules/authorization/application/ports/authorization.ports.js";
import type { AuthorizationPolicy } from "../../apps/api/src/modules/authorization/domain/policies/authorization.policy.js";

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
      reason: "resource-context-unavailable",
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
    ).resolves.toEqual({
      allowed: false,
      reason: "authorization-unavailable",
      failureCode: "role-lookup-failed",
    });
  });

  it("classifies resource and policy exceptions independently", async () => {
    const reporter = { report: vi.fn() };
    const resourceFailure = new AuthorizationService(
      new DefaultAuthorizationPolicy(),
      new FakeRoles("gestor"),
      { append: async () => {} },
      { getHelperCooldownDays: async () => 7 },
      {
        evaluate: async () => {
          throw new Error("resource outage");
        },
      },
      reporter,
    );
    await expect(
      resourceFailure.authorize(context, PERMISSIONS.SERIES_EDIT, {
        type: "series",
        id: "s",
      }),
    ).resolves.toEqual({
      allowed: false,
      reason: "authorization-unavailable",
      failureCode: "resource-evaluation-failed",
    });
    const throwingPolicy: AuthorizationPolicy = {
      evaluate: () => {
        throw new Error("policy bug");
      },
    };
    const policyFailure = new AuthorizationService(
      throwingPolicy,
      new FakeRoles("gestor"),
      { append: async () => {} },
      { getHelperCooldownDays: async () => 7 },
      undefined,
      reporter,
    );
    await expect(
      policyFailure.authorize(context, PERMISSIONS.SERIES_EDIT),
    ).resolves.toEqual({
      allowed: false,
      reason: "authorization-unavailable",
      failureCode: "policy-evaluation-failed",
    });
    expect(reporter.report).toHaveBeenCalledTimes(2);
  });

  it("reports getActorRole failures and survives a throwing reporter", async () => {
    const roles: AuthorizationRoleRepository = {
      findRoleByUserId: async () => {
        throw new Error("DB down");
      },
    };
    const reporter = {
      report: vi.fn(() => {
        throw new Error("logger down");
      }),
    };
    const service = new AuthorizationService(
      new DefaultAuthorizationPolicy(),
      roles,
      { append: async () => {} },
      { getHelperCooldownDays: async () => 7 },
      undefined,
      reporter,
    );
    await expect(service.getActorRole(context)).resolves.toBeNull();
    await expect(
      service.authorize(context, PERMISSIONS.SERIES_READ),
    ).resolves.toMatchObject({
      allowed: false,
      reason: "authorization-unavailable",
      failureCode: "role-lookup-failed",
    });
    expect(reporter.report).toHaveBeenCalledTimes(2);
  });

  it("classifies cooldown read failure separately", async () => {
    const reporter = { report: vi.fn() };
    const service = new AuthorizationService(
      new DefaultAuthorizationPolicy(),
      new FakeRoles("uploader"),
      { append: async () => {} },
      {
        getHelperCooldownDays: async () => {
          throw new Error("settings down");
        },
      },
      undefined,
      reporter,
    );
    await expect(service.getHelperCooldownDecision()).resolves.toEqual({
      allowed: false,
      reason: "authorization-unavailable",
      failureCode: "helper-cooldown-read-failed",
    });
    expect(reporter.report).toHaveBeenCalledWith(
      expect.objectContaining({ code: "helper-cooldown-read-failed" }),
    );
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
      reason: "authorization-unavailable",
      failureCode: "helper-cooldown-invalid",
    });
  });
});
