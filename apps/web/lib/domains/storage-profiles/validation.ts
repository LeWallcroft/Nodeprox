import type { StorageProfileDraftInput } from "./types";

export type StorageProfileField = keyof Omit<
  StorageProfileDraftInput,
  "b2ApplicationKey"
>;

export function validateStorageProfileField(
  field: StorageProfileField | "b2ApplicationKey",
  rawValue: string,
): string | null {
  const value = rawValue.trim();
  if (field === "name") {
    if (!value) return "El nombre del perfil es obligatorio.";
    if (value.length > 120) return "El nombre no puede superar 120 caracteres.";
  }
  if (field === "publicHostnameLabel") {
    if (!/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(value))
      return "Usa 1–63 caracteres en minúsculas, números o guiones; empieza y termina con letra o número.";
    if (["media", "www", "api", "app", "admin"].includes(value))
      return "Esta etiqueta está reservada por NodeProx.";
  }
  if (field === "b2Endpoint") {
    if (!value) return "El endpoint S3 es obligatorio.";
    try {
      const url = new URL(value);
      if (!url.hostname || !["http:", "https:"].includes(url.protocol))
        return "Introduce una URL absoluta válida.";
    } catch {
      return "Introduce una URL absoluta válida.";
    }
  }
  if (field === "b2Region" && (!value || value.length > 120))
    return "La región es obligatoria y no puede superar 120 caracteres.";
  if (field === "b2Bucket" && (!value || value.length > 255))
    return "El bucket es obligatorio y no puede superar 255 caracteres.";
  if (field === "b2KeyId" && (!value || value.length > 255))
    return "El Application Key ID es obligatorio y no puede superar 255 caracteres.";
  if (
    field === "b2ApplicationKey" &&
    rawValue.length > 0 &&
    (rawValue.length < 1 || rawValue.length > 2048)
  )
    return "La Application Key debe tener entre 1 y 2048 caracteres.";
  return null;
}

export function validateStorageProfileDraft(
  draft: StorageProfileDraftInput,
): Partial<Record<StorageProfileField, string>> {
  const fields: StorageProfileField[] = [
    "name",
    "publicHostnameLabel",
    "b2Endpoint",
    "b2Region",
    "b2Bucket",
    "b2KeyId",
  ];
  return Object.fromEntries(
    fields.flatMap((field) => {
      const error = validateStorageProfileField(field, draft[field] ?? "");
      return error ? [[field, error]] : [];
    }),
  );
}
