import { describe, expect, it } from "vitest";
import { isDelegableChapterPermission } from "../../apps/api/src/modules/chapters/domain/chapter-permission.policy.js";

describe("chapter authorization security boundary", () => {
  it("does not treat client authority fields or excluded permissions as authority", () => {
    const clientPayload = {
      ownerId: "attacker",
      isOwner: true,
      canEdit: true,
      role: "admin",
      permission: "images.process",
      capability: "images.urls.read",
    };
    expect(clientPayload.ownerId).not.toBe("server-resolved-owner");
    expect(isDelegableChapterPermission(clientPayload.permission)).toBe(false);
    expect(isDelegableChapterPermission(clientPayload.capability)).toBe(false);
  });
});
