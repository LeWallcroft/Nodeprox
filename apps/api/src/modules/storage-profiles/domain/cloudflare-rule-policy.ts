export const MANAGED_CACHE_RULE_REF = "nodeprox_media_profiles_v1";
export const CLOUDFLARE_RULE_LIMIT = 10;

export type CloudflareRuleSnapshot = {
  id: string;
  ref: string | null;
  expression: string;
  enabled: boolean;
  action: string;
  actionParameters?: Record<string, unknown>;
};

export function transformRuleRef(profileId: string): string {
  return `nodeprox_storage_${profileId}`;
}

export function transformRuleExpression(hostname: string): string {
  return `(http.host eq "${hostname}" and not starts_with(http.request.uri.path, "/Media/") and not starts_with(http.request.uri.path, "/file/"))`;
}

export function transformRuleParameters(
  bucket: string,
): Record<string, unknown> {
  if (!/^[a-zA-Z0-9-]+$/.test(bucket)) throw new Error("invalid-b2-bucket");
  return {
    uri: {
      path: {
        expression: `concat("/file/${bucket}/Media", http.request.uri.path)`,
      },
    },
  };
}

export function managedCacheExpression(hostnames: readonly string[]): string {
  const unique = [...new Set(hostnames)].sort();
  if (
    unique.length === 0 ||
    unique.some((value) => !/^[a-z0-9-]+\.nodeprox\.org$/.test(value))
  )
    throw new Error("invalid-managed-hostname-set");
  return `http.host in { ${unique.map((value) => `"${value}"`).join(" ")} }`;
}

export function managedCacheParameters(): Record<string, unknown> {
  return {
    cache: true,
    edge_ttl: { mode: "override_origin", default: 31_536_000 },
    browser_ttl: { mode: "override_origin", default: 7_200 },
    cache_key: {
      custom_key: {
        query_string: { exclude: { all: true } },
      },
    },
  };
}

/** Only exact-host predicates or explicit host sets prove a foreign rule disjoint. */
export function foreignRuleMayMatchHostname(
  expression: string,
  hostname: string,
): boolean {
  if (/\bor\b/i.test(expression)) return true;
  const exact = [...expression.matchAll(/http\.host\s+eq\s+"([^"]+)"/g)].map(
    (match) => match[1],
  );
  const sets = [
    ...expression.matchAll(/http\.host\s+in\s+\{([^}]+)\}/g),
  ].flatMap((match) =>
    [...(match[1] ?? "").matchAll(/"([^"]+)"/g)].map((item) => item[1]),
  );
  const hosts = [...exact, ...sets];
  if (
    hosts.length === 0 ||
    /http\.host/g.test(
      expression.replace(/http\.host\s+(?:eq\s+"[^"]+"|in\s+\{[^}]+\})/g, ""),
    )
  )
    return true;
  return hosts.includes(hostname);
}

export function assertNoForeignRuleConflict(
  rules: readonly CloudflareRuleSnapshot[],
  hostname: string,
  ownedRef: string,
  kind: "transform" | "cache",
): void {
  for (const rule of rules) {
    if (!rule.enabled || rule.ref === ownedRef) continue;
    if (kind === "transform" && rule.action !== "rewrite") continue;
    if (kind === "cache" && rule.action !== "set_cache_settings") continue;
    if (foreignRuleMayMatchHostname(rule.expression, hostname))
      throw new CloudflareRuleConflictError();
  }
}

export class CloudflareRuleConflictError extends Error {
  constructor() {
    super("CLOUDFLARE_RULE_CONFLICT");
  }
}

export class CloudflareRuleCapacityError extends Error {
  constructor() {
    super("CLOUDFLARE_RULE_CAPACITY_EXHAUSTED");
  }
}

export function assertRuleCapacity(
  rules: readonly CloudflareRuleSnapshot[],
  ownedRef: string,
): void {
  if (
    !rules.some((rule) => rule.ref === ownedRef) &&
    rules.filter((rule) => rule.enabled).length >= CLOUDFLARE_RULE_LIMIT
  )
    throw new CloudflareRuleCapacityError();
}
