import { describe, expect, it } from "vitest";
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
  } = {},
) {
  const roles: AuthorizationRoleRepository = overrides.roles ?? {
    findRoleByUserId: async () => role,
  };
  const audit: AuthorizationAuditRepository = { append: async () => undefined };
  const chapters: ChapterRepositoryPort = {
    findById: async () => chapter,
  };
  const users: ChapterUserPort = { existsById: async () => true };
  const permissions: ChapterPermissionRepositoryPort = {
    grant: async () => ({ outcome: "granted", count: 1 }),
    revoke: async () => ({ count: 1 }),
    hasActivePermission: async () => active,
    listActive: async () => [],
  };
  const authorization = new AuthorizationService(
    new DefaultAuthorizationPolicy(),
    roles,
    audit,
    { getHelperCooldownDays: async () => cooldown },
  );
  return new ChapterPermissionService(
    authorization,
    overrides.chapters ?? chapters,
    overrides.users ?? users,
    overrides.permissions ?? permissions,
    audit,
  );
}

describe("chapter permission service", () => {
  it("allows the server-resolved owner", async () => {
    await expect(
      serviceFor("uploader").check({
        context,
        chapterId: "chapter",
        permission: "chapters.edit",
      }),
    ).resolves.toMatchObject({ allowed: true, reason: "owner" });
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
      revoke: async () => ({ count: 0 }),
      hasActivePermission: async () => false,
      listActive: async () => [],
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
    ).rejects.toThrow("chapter repository unavailable");

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
      revoke: async () => {
        revokeCalls.push("revoke");
        throw new Error("permission repository unavailable");
      },
      hasActivePermission: async () => true,
      listActive: async () => [],
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
    expect(revokeCalls).toEqual(["revoke"]);

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
    ).rejects.toThrow("chapter repository unavailable");

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
});
