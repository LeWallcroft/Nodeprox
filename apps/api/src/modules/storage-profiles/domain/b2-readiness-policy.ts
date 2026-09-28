import type {
  B2CorsRule,
  B2LifecycleRule,
} from "../application/ports/b2-administration.ports.js";

export const NODEPROX_CORS_RULE_NAME = "nodeprox-browser-upload-v1";
export const NODEPROX_LIFECYCLE_RULE_ID = "nodeprox-uploads-v1";

export function desiredNodeProxCors(origins: readonly string[]): B2CorsRule {
  const unique = [...new Set(origins)];
  if (
    !unique.length ||
    unique.some((value) => {
      try {
        const url = new URL(value);
        return (
          !["http:", "https:"].includes(url.protocol) ||
          url.origin !== value ||
          Boolean(url.username || url.password)
        );
      } catch {
        return true;
      }
    })
  )
    throw new Error("B2_CORS_ORIGINS_INVALID");
  return {
    corsRuleName: NODEPROX_CORS_RULE_NAME,
    allowedOrigins: unique.sort(),
    allowedOperations: ["s3_put"],
    allowedHeaders: ["content-type"],
    exposeHeaders: ["ETag"],
    maxAgeSeconds: 3600,
  };
}

export function equivalentCors(left: B2CorsRule, right: B2CorsRule): boolean {
  const sorted = (items: readonly string[]) =>
    [...items]
      .map((item) => item.toLowerCase())
      .sort()
      .join("\0");
  return (
    left.corsRuleName === right.corsRuleName &&
    sorted(left.allowedOrigins) === sorted(right.allowedOrigins) &&
    sorted(left.allowedOperations) === sorted(right.allowedOperations) &&
    sorted(left.allowedHeaders) === sorted(right.allowedHeaders) &&
    sorted(left.exposeHeaders) === sorted(right.exposeHeaders) &&
    left.maxAgeSeconds === right.maxAgeSeconds
  );
}

export function desiredNodeProxLifecycle(): B2LifecycleRule {
  return {
    id: NODEPROX_LIFECYCLE_RULE_ID,
    prefix: "uploads/",
    expirationDays: 1,
    noncurrentDays: 1,
    abortMultipartDays: 1,
  };
}

export function equivalentLifecycle(
  left: B2LifecycleRule,
  right: B2LifecycleRule,
): boolean {
  return (
    left.id === right.id &&
    left.prefix === right.prefix &&
    left.expirationDays === right.expirationDays &&
    left.noncurrentDays === right.noncurrentDays &&
    left.abortMultipartDays === right.abortMultipartDays
  );
}

export function harmfulMediaLifecycle(
  rules: readonly B2LifecycleRule[],
): boolean {
  return rules.some(
    (rule) =>
      rule.id !== NODEPROX_LIFECYCLE_RULE_ID &&
      (rule.expirationDays !== null || rule.noncurrentDays !== null) &&
      (rule.prefix === "" ||
        "Media/".startsWith(rule.prefix) ||
        rule.prefix.startsWith("Media/")),
  );
}
