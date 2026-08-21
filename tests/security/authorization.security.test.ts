import { describe, expect, it } from "vitest";
import { AuthorizationService } from "../../apps/api/src/modules/authorization/application/services/authorization.service.js";
import type { AuthorizationRoleRepository } from "../../apps/api/src/modules/authorization/application/ports/authorization.ports.js";
import { DefaultAuthorizationPolicy } from "../../apps/api/src/modules/authorization/domain/policies/authorization.policy.js";
import { PERMISSIONS } from "../../apps/api/src/modules/authorization/domain/permissions.js";

const roles: AuthorizationRoleRepository = {
  findRoleByUserId: async () => "uploader",
};

const service = new AuthorizationService(
  new DefaultAuthorizationPolicy(),
  roles,
  { append: async () => {} },
  { getHelperCooldownDays: async () => 7 },
);

describe("M2-A authorization security boundary", () => {
  it("does not accept a client-supplied role or capability as authority", async () => {
    const decision = await service.authorize(
      { userId: "user-1", sessionId: "session-1" },
      "admin.system.manage" as never,
    );
    expect(decision).toMatchObject({
      allowed: false,
      reason: "permission-denied",
    });
  });

  it.each([
    "ownerId",
    "isOwner",
    "canEdit",
    "role",
    "permission",
    "capability",
  ])("does not use client field %s as authority", async (field) => {
    const clientPayload = { [field]: "admin" };
    const decision = await service.authorize(
      { userId: "user-1", sessionId: "session-1" },
      PERMISSIONS.ADMIN_USERS_MANAGE,
    );
    expect(clientPayload).toBeDefined();
    expect(decision).toMatchObject({
      allowed: false,
      reason: "permission-denied",
    });
  });

  it("denies resource authorization when trusted ownership data is unavailable", async () => {
    const decision = await service.authorize(
      { userId: "user-1", sessionId: "session-1" },
      PERMISSIONS.SERIES_EDIT,
      { type: "series", id: "attacker-supplied-id" },
    );
    expect(decision).toMatchObject({
      allowed: false,
      reason: "resource-context-unavailable",
    });
  });
});
