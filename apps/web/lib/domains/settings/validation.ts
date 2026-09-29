import type { ProductSettingField } from "./types";

export type SettingValidationResult =
  | { valid: true; value: number }
  | { valid: false; message: string };

export function validateNumericSetting(
  rawValue: string,
  field: ProductSettingField,
): SettingValidationResult {
  const normalized = rawValue.trim();
  if (!normalized)
    return { valid: false, message: "Este campo es obligatorio." };
  const value = Number(normalized);
  if (!Number.isFinite(value))
    return { valid: false, message: "Introduce un número válido." };
  if (!Number.isInteger(value))
    return { valid: false, message: "Introduce un número entero." };
  if (field.constraints?.min !== undefined && value < field.constraints.min)
    return {
      valid: false,
      message: `El valor mínimo es ${field.constraints.min}.`,
    };
  if (field.constraints?.max !== undefined && value > field.constraints.max)
    return {
      valid: false,
      message: `El valor máximo es ${field.constraints.max}.`,
    };
  return { valid: true, value };
}

export function productSettingChanges(
  fields: readonly ProductSettingField[],
  values: Record<string, string>,
  baseline: Record<string, string>,
) {
  return fields.flatMap((field) => {
    const rawValue = values[field.key] ?? "";
    if (rawValue === baseline[field.key]) return [];
    const result = validateNumericSetting(rawValue, field);
    return result.valid ? [{ key: field.key, value: result.value }] : [];
  });
}

export function canSaveProductSettings(input: {
  dirty: boolean;
  invalid: boolean;
  pending: boolean;
}) {
  return input.dirty && !input.invalid && !input.pending;
}
