const ALLOWED_METADATA_KEYS = new Set([
  "requestId",
  "userId",
  "sessionId",
  "reason",
  "fromRole",
  "toRole",
  "resourceType",
  "resourceId",
  "configKey",
  "result",
  "imageCount",
]);

const SENSITIVE_KEY_PATTERN =
  /password|token|cookie|authorization|secret|credential|api.?key|nodeprox_session/i;

export type AuditMetadata = Readonly<
  Record<string, string | number | boolean | null>
>;

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
  const sanitized: Record<string, string | number | boolean | null> = {};
  for (const [key, value] of Object.entries(metadata)) {
    if (SENSITIVE_KEY_PATTERN.test(key) || !ALLOWED_METADATA_KEYS.has(key))
      throw new InvalidAuditMetadataError(key);
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
