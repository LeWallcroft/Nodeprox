import { describe, expect, it } from "vitest";
import type { ProductSettingField } from "./types";
import {
  canSaveProductSettings,
  productSettingChanges,
  validateNumericSetting,
} from "./validation";

const field: ProductSettingField = {
  key: "limit",
  label: "Límite",
  description: "Cantidad entera.",
  unit: "cargas",
  helpText: "Cantidad entera.",
  impact: "Afecta la concurrencia.",
  type: "number",
  value: 2,
  editable: true,
  constraints: { min: 1, max: 5 },
};

describe("validateNumericSetting", () => {
  it("requires a finite integer and enforces inclusive limits", () => {
    expect(validateNumericSetting("", field)).toMatchObject({ valid: false });
    expect(validateNumericSetting("Infinity", field)).toMatchObject({
      valid: false,
    });
    expect(validateNumericSetting("1.5", field)).toMatchObject({
      valid: false,
      message: "Introduce un número entero.",
    });
    expect(validateNumericSetting("0", field)).toMatchObject({ valid: false });
    expect(validateNumericSetting("6", field)).toMatchObject({ valid: false });
    expect(validateNumericSetting("5", field)).toEqual({
      valid: true,
      value: 5,
    });
  });

  it("tracks dirty values, supports reset baselines, and disables invalid saves", () => {
    const baseline = { limit: "2" };
    const edited = { limit: "4" };
    const invalid = { limit: "6" };
    expect(productSettingChanges([field], edited, baseline)).toEqual([
      { key: "limit", value: 4 },
    ]);
    expect(productSettingChanges([field], baseline, baseline)).toEqual([]);
    expect(
      canSaveProductSettings({ dirty: true, invalid: false, pending: false }),
    ).toBe(true);
    expect(
      canSaveProductSettings({ dirty: true, invalid: true, pending: false }),
    ).toBe(false);
    expect(
      canSaveProductSettings({ dirty: true, invalid: false, pending: true }),
    ).toBe(false);
    expect(productSettingChanges([field], invalid, baseline)).toEqual([]);
  });
});
