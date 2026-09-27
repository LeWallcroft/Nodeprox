import { describe, expect, it, vi } from "vitest";
import { DefaultAuthorizationPolicy } from "../../apps/api/src/modules/authorization/domain/policies/authorization.policy.js";
import { AuthorizationService } from "../../apps/api/src/modules/authorization/application/services/authorization.service.js";
import type {
  AuthorizationAuditRepository,
  AuthorizationRoleRepository,
} from "../../apps/api/src/modules/authorization/application/ports/authorization.ports.js";
import { ChapterPermissionService } from "../../apps/api/src/modules/chapters/application/services/chapter-permission.service.js";
import type {
  ChapterPermissionRepositoryPort,
  ChapterRepositoryPort,
  ChapterUserPort,
} from "../../apps/api/src/modules/chapters/application/ports/chapter.ports.js";

const context = { userId: "owner", sessionId: "session" };
const chapter = {
  id: "chapter",
  seriesId: "series",
  createdBy: "owner",
  createdAt: new Date(),
  updatedAt: new Date(),
};

function serviceFor(
  role: string | null,
  active = false,
  cooldown = 7,
  overrides: {
    chapters?: ChapterRepositoryPort;
    users?: ChapterUserPort;
    permissions?: ChapterPermissionRepositoryPort;
    roles?: AuthorizationRoleRepository;
    failures?: { report: (input: { code: string; operation: string }) => void };
    config?: { getHelperCooldownDays: () => Promise<number> };
    authorizationFailures?: {
      report: (input: { code: string; operation: string }) => void;
    };
    audit?: AuthorizationAuditRepository;
  } = {},
) {
  const roles: AuthorizationRoleRepository = overrides.roles ?? {
    findRoleByUserId: async () => role,
  };
  const audit: AuthorizationAuditRepository = overrides.audit ?? {
    append: async () => undefined,
  };
  const chapters: ChapterRepositoryPort = {
    findById: async () => chapter,
    isAssigned: async (_seriesId, userId) => userId === "owner",
  };
  const users: ChapterUserPort = { existsById: async () => true };
  const permissions: ChapterPermissionRepositoryPort = {
    grant: async () => ({ outcome: "granted", count: 1 }),
    revokeIfAuthorized: async () => ({ outcome: "revoked", count: 1 }),
    hasActivePermission: async () => active,
    hasAnyActivePermission: async () => active,
    listActive: async () => [],
    listActiveWithUsers: async () => [],
    listEligibleCandidates: async () => [],
  };
  const authorization = new AuthorizationService(
    new DefaultAuthorizationPolicy(),
    roles,
    audit,
    overrides.config ?? { getHelperCooldownDays: async () => cooldown },
    undefined,
    overrides.authorizationFailures,
  );
  return new ChapterPermissionService(
    authorization,
    overrides.chapters ?? chapters,
    overrides.users ?? users,
    overrides.permissions ?? permissions,
    audit,
    overrides.failures,
  );
}

describe("chapter permission service", () => {
  it("projects helper-management capabilities for an admin through policy", async () => {
    const admin = serviceFor("admin");
    await expect(
      admin.check({
        context: { userId: "admin", sessionId: "session" },
        chapterId: "chapter",
        permission: "chapters.helper.grant",
      }),
    ).resolves.toMatchObject({ allowed: true, reason: "role" });
    await expect(
      admin.check({
        context: { userId: "admin", sessionId: "session" },
        chapterId: "chapter",
        permission: "chapters.helper.revoke",
      }),
    ).resolves.toMatchObject({ allowed: true, reason: "role" });
  });

  it("allows an uploader only while server-side assignment is active", async () => {
    await expect(
      serviceFor("uploader").check({
        context,
        chapterId: "chapter",
        permission: "chapters.edit",
      }),
    ).resolves.toMatchObject({ allowed: true, reason: "assigned" });
    await expect(
      serviceFor("uploader", false, 7, {
        chapters: { findById: async () => chapter },
      }).check({
        context,
        chapterId: "chapter",
        permission: "chapters.edit",
      }),
    ).resolves.toMatchObject({ allowed: false, reason: "denied" });
  });

  it("allows a helper only with an active delegated permission", async () => {
    const helper = serviceFor("uploader", true);
    await expect(
      helper.check({
        context: { userId: "helper", sessionId: "session" },
        chapterId: "chapter",
        permission: "chapters.edit",
      }),
    ).resolves.toMatchObject({ allowed: true, reason: "helper" });
    await expect(
      serviceFor("uploader", false).check({
        context: { userId: "helper", sessionId: "session" },
        chapterId: "chapter",
        permission: "chapters.edit",
      }),
    ).resolves.toMatchObject({ allowed: false, reason: "denied" });
  });

  it("denies an unknown role and invalid cooldown fail-closed", async () => {
    await expect(
      serviceFor("unknown").check({
        context,
        chapterId: "chapter",
        permission: "chapters.edit",
      }),
    ).resolves.toMatchObject({ allowed: false });
    const invalidConfig = serviceFor("uploader", false, -1);
    await expect(
      invalidConfig.grant({
        context,
        chapterId: "chapter",
        helperUserId: "helper",
        permissions: ["chapters.edit"],
      }),
    ).resolves.toMatchObject({ denied: true });
  });

  it("fails closed on grant infrastructure errors without mutation", async () => {
    const grantCalls: string[] = [];
    const failingPermissionRepository: ChapterPermissionRepositoryPort = {
      grant: async () => {
        grantCalls.push("grant");
        throw new Error("permission repository unavailable");
      },
      revokeIfAuthorized: async () => ({ outcome: "revoked", count: 0 }),
      hasActivePermission: async () => false,
      hasAnyActivePermission: async () => false,
      listActive: async () => [],
      listActiveWithUsers: async () => [],
      listEligibleCandidates: async () => [],
    };
    await expect(
      serviceFor("uploader", false, 7, {
        permissions: failingPermissionRepository,
      }).grant({
        context,
        chapterId: "chapter",
        helperUserId: "helper",
        permissions: ["chapters.edit"],
      }),
    ).rejects.toThrow("permission repository unavailable");
    expect(grantCalls).toEqual(["grant"]);

    await expect(
      serviceFor("uploader", false, 7, {
        chapters: {
          findById: async () => {
            throw new Error("chapter repository unavailable");
          },
        },
      }).grant({
        context,
        chapterId: "chapter",
        helperUserId: "helper",
        permissions: ["chapters.edit"],
      }),
    ).resolves.toMatchObject({ denied: true });

    let userLookupCompleted = false;
    await expect(
      serviceFor("uploader", false, 7, {
        users: {
          existsById: async () => {
            userLookupCompleted = true;
            throw new Error("user repository unavailable");
          },
        },
      }).grant({
        context,
        chapterId: "chapter",
        helperUserId: "helper",
        permissions: ["chapters.edit"],
      }),
    ).rejects.toThrow("user repository unavailable");
    expect(userLookupCompleted).toBe(true);

    await expect(
      serviceFor("uploader", false, 7, {
        roles: {
          findRoleByUserId: async () => {
            throw new Error("role repository unavailable");
          },
        },
      }).grant({
        context,
        chapterId: "chapter",
        helperUserId: "helper",
        permissions: ["chapters.edit"],
      }),
    ).resolves.toMatchObject({ denied: true });
  });

  it("fails closed on revoke infrastructure errors without partial mutation", async () => {
    const revokeCalls: string[] = [];
    const failingPermissionRepository: ChapterPermissionRepositoryPort = {
      grant: async () => ({ outcome: "granted", count: 1 }),
      revokeIfAuthorized: async () => {
        revokeCalls.push("revokeIfAuthorized");
        throw new Error("permission repository unavailable");
      },
      hasActivePermission: async () => true,
      hasAnyActivePermission: async () => true,
      listActive: async () => [],
      listActiveWithUsers: async () => [],
      listEligibleCandidates: async () => [],
    };
    await expect(
      serviceFor("uploader", false, 7, {
        permissions: failingPermissionRepository,
      }).revoke({
        context,
        chapterId: "chapter",
        helperUserId: "helper",
      }),
    ).rejects.toThrow("permission repository unavailable");
    expect(revokeCalls).toEqual(["revokeIfAuthorized"]);

    await expect(
      serviceFor("uploader", false, 7, {
        chapters: {
          findById: async () => {
            throw new Error("chapter repository unavailable");
          },
        },
      }).revoke({
        context,
        chapterId: "chapter",
        helperUserId: "helper",
      }),
    ).resolves.toMatchObject({ denied: true });

    await expect(
      serviceFor("uploader", false, 7, {
        roles: {
          findRoleByUserId: async () => {
            throw new Error("role repository unavailable");
          },
        },
      }).revoke({
        context,
        chapterId: "chapter",
        helperUserId: "helper",
      }),
    ).resolves.toMatchObject({ denied: true });
  });

  it("classifies chapter, owner, assignment and helper lookup failures", async () => {
    const reporter = { report: vi.fn() };
    const failing = (message: string) => {
      throw new Error(message);
    };
    const cases = [
      {
        service: serviceFor("uploader", false, 7, {
          chapters: { findById: async () => failing("read") },
          failures: reporter,
        }),
        code: "chapter-read-failed",
        permission: "chapters.edit",
      },
      {
        service: serviceFor("gestor", false, 7, {
          chapters: {
            findById: async () => chapter,
            isSeriesOwner: async () => failing("owner"),
          },
          failures: reporter,
        }),
        code: "series-owner-evaluation-failed",
        permission: "chapters.edit",
      },
      {
        service: serviceFor("uploader", false, 7, {
          chapters: {
            findById: async () => chapter,
            isAssigned: async () => failing("assignment"),
          },
          failures: reporter,
        }),
        code: "series-assignment-evaluation-failed",
        permission: "chapters.edit",
      },
      {
        service: serviceFor("uploader", false, 7, {
          chapters: { findById: async () => chapter },
          permissions: {
            grant: async () => ({ outcome: "granted", count: 1 }),
            revokeIfAuthorized: async () => ({ outcome: "revoked", count: 1 }),
            hasActivePermission: async () => failing("helper"),
            hasAnyActivePermission: async () => false,
            listActive: async () => [],
            listActiveWithUsers: async () => [],
            listEligibleCandidates: async () => [],
          },
          failures: reporter,
        }),
        code: "helper-permission-evaluation-failed",
        permission: "chapters.edit",
      },
    ];
    for (const item of cases) {
      await expect(
        item.service.check({
          context,
          chapterId: "chapter",
          permission: item.permission,
        }),
      ).resolves.toEqual({
        allowed: false,
        reason: "authorization-unavailable",
        failureCode: item.code,
      });
    }
    expect(reporter.report).toHaveBeenCalledTimes(4);
  });

  it("preserves upstream technical failure and never uses helper fallback", async () => {
    const service = serviceFor("uploader", true, 7, {
      roles: {
        findRoleByUserId: async () => {
          throw new Error("roles down");
        },
      },
    });
    await expect(
      service.check({
        context,
        chapterId: "chapter",
        permission: "chapters.read",
      }),
    ).resolves.toEqual({
      allowed: false,
      reason: "authorization-unavailable",
      failureCode: "role-lookup-failed",
    });
    await expect(
      service.canReadContext(context, "chapter"),
    ).resolves.toMatchObject({
      allowed: false,
      reason: "authorization-unavailable",
      failureCode: "role-lookup-failed",
    });
  });

  it.each([
    [
      "read failure",
      {
        getHelperCooldownDays: async () => {
          throw new Error("settings unavailable");
        },
      },
      "helper-cooldown-read-failed",
    ],
    [
      "invalid value",
      { getHelperCooldownDays: async () => -1 },
      "helper-cooldown-invalid",
    ],
  ])("denies grant and revoke on cooldown %s", async (_name, config, code) => {
    const reporter = { report: vi.fn() };
    const audit = { append: vi.fn(async () => undefined) };
    const service = serviceFor("uploader", false, 7, {
      config,
      authorizationFailures: reporter,
      audit,
    });
    await expect(
      service.grant({
        context,
        chapterId: "chapter",
        helperUserId: "helper",
        permissions: ["chapters.edit"],
      }),
    ).resolves.toEqual({ denied: true });
    await expect(
      service.revoke({ context, chapterId: "chapter", helperUserId: "helper" }),
    ).resolves.toEqual({ denied: true });
    expect(reporter.report).toHaveBeenCalledWith(
      expect.objectContaining({ code }),
    );
    expect(audit.append).not.toHaveBeenCalled();
  });
});
