export const REQUIRED_STORAGE_PROFILE_CHECKS = [
  "b2_credentials",
  "b2_bucket",
  "b2_cors",
  "b2_lifecycle",
  "b2_storage_probe",
  "b2_browser_upload",
  "cloudflare_dns",
  "cloudflare_transform",
  "cloudflare_cache",
  "cloudflare_delivery",
] as const;

export type StorageProfileCheckType =
  (typeof REQUIRED_STORAGE_PROFILE_CHECKS)[number];
export type StorageProfileCheckStatus =
  | "pending"
  | "checking"
  | "verified"
  | "manual_required"
  | "failed";
export type StorageProfileCheck = {
  id: string;
  profileId: string;
  checkType: StorageProfileCheckType;
  status: StorageProfileCheckStatus;
  lastErrorCode: string | null;
  metadata: Record<string, string | number | boolean | null>;
  checkedAt: Date | null;
  verifiedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
};

export function blockingStorageProfileChecks(
  checks: readonly StorageProfileCheck[],
): StorageProfileCheckType[] {
  return REQUIRED_STORAGE_PROFILE_CHECKS.filter(
    (type) =>
      !checks.some(
        (check) => check.checkType === type && check.status === "verified",
      ),
  );
}

const SAFE_METADATA_KEYS = new Set([
  "desiredCorsRuleName",
  "desiredCorsConfiguration",
  "allowedOriginCount",
  "bucketPublic",
  "providerCapabilityMissing",
  "desiredLifecycleRuleId",
  "desiredLifecycleConfiguration",
  "transformRuleRef",
  "capacityUsed",
  "capacityLimit",
  "probeTimestamp",
]);

export function safeReadinessMetadata(
  input: Record<string, unknown>,
): StorageProfileCheck["metadata"] {
  const result: StorageProfileCheck["metadata"] = {};
  for (const [key, value] of Object.entries(input)) {
    if (!SAFE_METADATA_KEYS.has(key)) continue;
    if (
      value === null ||
      typeof value === "string" ||
      typeof value === "number" ||
      typeof value === "boolean"
    )
      result[key] = value;
  }
  return result;
}
