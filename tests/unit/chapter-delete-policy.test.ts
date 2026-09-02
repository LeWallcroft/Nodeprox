import { describe, expect, it } from "vitest";
import { evaluateChapterDelete } from "../../apps/api/src/modules/chapters/domain/chapter-delete.policy.js";

const base = {
  permission: "chapters.delete" as const,
};

describe("M3 chapter delete policy", () => {
  it("allows admin, any gestor, and the assigned uploader", () => {
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
    ).toMatchObject({ allowed: true, reason: "gestor" });
    expect(
      evaluateChapterDelete({
        ...base,
        actorRole: "uploader",
        assigned: true,
      }),
    ).toMatchObject({ allowed: true, reason: "assigned" });
  });

  it("denies helpers and non-owners and never accepts another permission", () => {
    expect(
      evaluateChapterDelete({
        ...base,
        permission: "chapters.edit",
        actorRole: "uploader",
      }),
    ).toMatchObject({ allowed: false, reason: "wrong-permission" });
    expect(
      evaluateChapterDelete({
        ...base,
        actorRole: "uploader",
      }),
    ).toMatchObject({ allowed: false, reason: "not-owner" });
  });
});
