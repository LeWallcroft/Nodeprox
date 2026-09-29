import { describe, expect, it } from "vitest";
import {
  assertNoForeignRuleConflict,
  assertRuleCapacity,
  foreignRuleMayMatchHostname,
  managedCacheExpression,
  managedCacheParameters,
  transformRuleExpression,
  transformRuleParameters,
  transformRuleRef,
} from "./cloudflare-rule-policy.js";

describe("managed Cloudflare rules", () => {
  it("uses stable per-profile transform refs and exact hostname rewrites", () => {
    expect(transformRuleRef("abc")).toBe("nodeprox_storage_abc");
    expect(transformRuleExpression("manga.nodeprox.org")).toContain(
      'http.host eq "manga.nodeprox.org"',
    );
    expect(transformRuleParameters("nodeprox")).toEqual({
      uri: {
        path: {
          expression: 'concat("/file/nodeprox/Media", http.request.uri.path)',
        },
      },
    });
  });
  it("excludes query strings using the Rulesets API contract without overriding Origin", () => {
    expect(
      managedCacheExpression([
        "b.nodeprox.org",
        "a.nodeprox.org",
        "a.nodeprox.org",
      ]),
    ).toBe('http.host in { "a.nodeprox.org" "b.nodeprox.org" }');
    const parameters = managedCacheParameters() as {
      cache: boolean;
      edge_ttl: { mode: string; default: number };
      browser_ttl: { mode: string; default: number };
      cache_key: {
        custom_key: {
          query_string: { exclude: { all: boolean } };
          header?: { include?: string[] };
          exclude_origin?: boolean;
        };
      };
    };
    expect(parameters).toMatchObject({
      cache: true,
      edge_ttl: { mode: "override_origin", default: 31_536_000 },
      browser_ttl: { mode: "override_origin", default: 7_200 },
      cache_key: { custom_key: { query_string: { exclude: { all: true } } } },
    });
    expect(parameters.cache_key.custom_key.header).toBeUndefined();
    expect(parameters.cache_key.custom_key.exclude_origin).toBeUndefined();
  });
  it("treats broad or ambiguous foreign rewrite expressions as conflicts while preserving exact legacy host", () => {
    const legacy = {
      id: "legacy",
      ref: "legacy",
      expression: 'http.host eq "media.nodeprox.org"',
      enabled: true,
      action: "rewrite",
    };
    expect(() =>
      assertNoForeignRuleConflict(
        [legacy],
        "manga.nodeprox.org",
        "nodeprox_storage_a",
        "transform",
      ),
    ).not.toThrow();
    expect(foreignRuleMayMatchHostname("true", "manga.nodeprox.org")).toBe(
      true,
    );
    expect(() =>
      assertNoForeignRuleConflict(
        [{ ...legacy, expression: "true" }],
        "manga.nodeprox.org",
        "nodeprox_storage_a",
        "transform",
      ),
    ).toThrow("CLOUDFLARE_RULE_CONFLICT");
  });
  it("rejects a new rule at phase capacity", () => {
    const rules = Array.from({ length: 10 }, (_, index) => ({
      id: String(index),
      ref: null,
      expression: "false",
      enabled: true,
      action: "rewrite",
    }));
    expect(() => assertRuleCapacity(rules, "nodeprox_storage_a")).toThrow(
      "CLOUDFLARE_RULE_CAPACITY_EXHAUSTED",
    );
  });
});
