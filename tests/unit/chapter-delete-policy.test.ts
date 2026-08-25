import { describe, expect, it } from "vitest";
import { evaluateChapterDelete } from "../../apps/api/src/modules/chapters/domain/chapter-delete.policy.js";

const base = {
  actorId: "actor",
  chapterOwnerId: "owner",
  permission: "chapters.delete" as const,
};

describe("M3 chapter delete policy", () => {
  it("allows admin, gestor, and the owner", () => {
    expect(
      evaluateChapterDelete({ ...base, actorRole: "admin" }),
    ).toMatchObject({ allowed: true, reason: "admin" });
    expect(
      evaluateChapterDelete({
        ...base,
        actorRole: "gestor",
        seriesOwner: true,
      }),
    ).toMatchObject({ allowed: true, reason: "gestor" });
    expect(
      evaluateChapterDelete({ ...base, actorRole: "gestor" }),
    ).toMatchObject({ allowed: false, reason: "not-owner" });
    expect(
      evaluateChapterDelete({
        ...base,
        actorId: "owner",
        actorRole: "uploader",
      }),
    ).toMatchObject({ allowed: true, reason: "owner" });
  });

  it("denies helpers and non-owners and never accepts another permission", () => {
    expect(
      evaluateChapterDelete({ ...base, actorRole: "uploader" }),
    ).toMatchObject({ allowed: false });
    expect(
      evaluateChapterDelete({
        ...base,
        permission: "chapters.edit",
        actorRole: "uploader",
      }),
    ).toMatchObject({ allowed: false, reason: "wrong-permission" });
  });
});
