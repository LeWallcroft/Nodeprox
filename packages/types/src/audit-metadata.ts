const ALLOWED_METADATA_KEYS = new Set([
  "requestId",
  "userId",
  "sessionId",
  "reason",
  "fromRole",
  "toRole",
  "resourceType",
  "resourceId",
  "seriesId",
  "chapterId",
  "keys",
  "configKey",
  "result",
  "imageCount",
  "previousVersion",
  "currentVersion",
]);

const SENSITIVE_KEY_PATTERN =
  /password|token|cookie|authorization|secret|credential|api.?key|nodeprox_session/i;

export type AuditMetadataValue =
  | string
  | number
  | boolean
  | null
  | readonly string[];

export type AuditMetadata = Readonly<Record<string, AuditMetadataValue>>;

export class InvalidAuditMetadataError extends Error {
  constructor(key: string) {
    super(`Audit metadata key is not allowed: ${key}`);
    this.name = "InvalidAuditMetadataError";
  }
}

export function sanitizeAuditMetadata(
  metadata: Record<string, unknown> | undefined,
): AuditMetadata {
  if (!metadata) return {};
  const sanitized: Record<string, AuditMetadataValue> = {};
  for (const [key, value] of Object.entries(metadata)) {
    if (SENSITIVE_KEY_PATTERN.test(key) || !ALLOWED_METADATA_KEYS.has(key))
      throw new InvalidAuditMetadataError(key);
    if (Array.isArray(value)) {
      if (key !== "keys" || !value.every((item) => typeof item === "string"))
        throw new InvalidAuditMetadataError(key);
      sanitized[key] = value;
      continue;
    }
    if (
      value !== null &&
      typeof value !== "string" &&
      typeof value !== "number" &&
      typeof value !== "boolean"
    )
      throw new InvalidAuditMetadataError(key);
    sanitized[key] = value;
  }
  return sanitized;
}
