import { describe, expect, it } from "vitest";
import {
  isCooldownActive,
  isDelegableChapterPermission,
} from "../../apps/api/src/modules/chapters/domain/chapter-permission.policy.js";

describe("chapter permission policy", () => {
  const now = new Date("2026-08-22T00:00:00.000Z");

  it("allows only the AD-04 delegable M2-A permissions", () => {
    expect(isDelegableChapterPermission("chapters.edit")).toBe(true);
    expect(isDelegableChapterPermission("images.delete")).toBe(true);
    expect(isDelegableChapterPermission("images.process")).toBe(false);
    expect(isDelegableChapterPermission("images.urls.read")).toBe(false);
    expect(isDelegableChapterPermission("chapters.helper.grant")).toBe(false);
  });

  it("evaluates cooldown 0, active and expired windows", () => {
    expect(isCooldownActive(new Date("2026-08-21T00:00:00.000Z"), 0, now)).toBe(
      false,
    );
    expect(isCooldownActive(new Date("2026-08-21T00:00:00.000Z"), 7, now)).toBe(
      true,
    );
    expect(isCooldownActive(new Date("2026-08-01T00:00:00.000Z"), 7, now)).toBe(
      false,
    );
  });
});
