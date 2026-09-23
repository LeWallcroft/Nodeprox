import { describe, expect, it } from "vitest";
import {
  canDeleteSeries,
  canEditSeries,
  canManageSeriesAssignment,
} from "./series.policy.js";

describe("Series operation policies", () => {
  it.each([
    ["admin", false, false, true],
    ["gestor", true, false, true],
    ["gestor", false, false, true],
    ["uploader", false, true, true],
    ["uploader", false, false, false],
  ] as const)(
    "allows edit for %s owner=%s assigned=%s: %s",
    (role, isOwner, isAssigned, expected) => {
      expect(canEditSeries({ role, isOwner, isAssigned })).toBe(expected);
    },
  );

  it.each([
    ["admin", false, false, true],
    ["gestor", true, false, true],
    ["gestor", false, false, true],
    ["uploader", false, true, true],
    ["uploader", false, false, false],
  ] as const)(
    "allows assignment management for %s owner=%s assigned=%s: %s",
    (role, isOwner, isAssigned, expected) => {
      expect(canManageSeriesAssignment({ role, isOwner, isAssigned })).toBe(
        expected,
      );
    },
  );

  it.each([
    ["admin", false, false, true],
    ["gestor", true, false, false],
    ["gestor", false, false, false],
    ["uploader", false, true, false],
    ["uploader", true, false, false],
  ] as const)(
    "allows deletion for %s owner=%s assigned=%s: %s",
    (role, isOwner, isAssigned, expected) => {
      expect(canDeleteSeries({ role, isOwner, isAssigned })).toBe(expected);
    },
  );
});
