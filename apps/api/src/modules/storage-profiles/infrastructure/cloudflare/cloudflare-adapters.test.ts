import { describe, expect, it, vi } from "vitest";
import { managedCacheParameters } from "../../domain/cloudflare-rule-policy.js";
import {
  CloudflareClient,
  CloudflareProviderError,
  CloudflareRulesAdapter,
} from "./cloudflare-adapters.js";

describe("Cloudflare Rulesets adapter contract", () => {
  it("sends the exact supported cache-key payload to the Rulesets API", async () => {
    const requests: Array<{ url: string; init?: RequestInit }> = [];
    const fetcher = vi.fn(
      async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input);
        requests.push(init === undefined ? { url } : { url, init });
        if (init?.method === "GET")
          return Response.json({
            success: true,
            result: { id: "cache-ruleset", rules: [] },
          });
        return Response.json({
          success: true,
          result: {
            id: "cache-ruleset",
            rules: [{ id: "cache-rule", ref: "nodeprox_media_profiles_v1" }],
          },
        });
      },
    );
    const adapter = new CloudflareRulesAdapter(
      new CloudflareClient("zone", "private-test-token", fetcher),
    );
    const actionParameters = managedCacheParameters();

    await adapter.create("http_request_cache_settings", {
      ref: "nodeprox_media_profiles_v1",
      expression: 'http.host in { "manga.nodeprox.org" }',
      action: "set_cache_settings",
      actionParameters,
    });

    expect(JSON.parse(String(requests[1]?.init?.body))).toEqual({
      ref: "nodeprox_media_profiles_v1",
      expression: 'http.host in { "manga.nodeprox.org" }',
      action: "set_cache_settings",
      action_parameters: {
        cache: true,
        edge_ttl: { mode: "override_origin", default: 31_536_000 },
        browser_ttl: { mode: "override_origin", default: 7_200 },
        cache_key: {
          custom_key: {
            query_string: { exclude: { all: true } },
          },
        },
      },
      enabled: true,
    });
    expect(
      JSON.stringify(JSON.parse(String(requests[1]?.init?.body))),
    ).not.toContain('"include":["origin"]');
  });

  it("keeps safe provider status/code diagnostics without retaining arbitrary body text", async () => {
    const responseBody = {
      success: false,
      errors: [{ code: 1004, message: "unsafe provider detail and secret" }],
    };
    const fetcher = vi.fn(async () =>
      Response.json(responseBody, { status: 400 }),
    );
    const client = new CloudflareClient("zone", "private-test-token", fetcher);

    try {
      await client.request("POST", "/rulesets", {});
      throw new Error("expected Cloudflare rejection");
    } catch (error) {
      expect(error).toBeInstanceOf(CloudflareProviderError);
      expect(error).toMatchObject({
        code: "CLOUDFLARE_PROVIDER_ERROR",
        httpStatus: 400,
        providerCode: 1004,
        message: "CLOUDFLARE_PROVIDER_ERROR",
      });
      expect((error as Error).message).not.toContain("unsafe provider detail");
      expect((error as Error).message).not.toContain("private-test-token");
    }
  });

  it("maps authorization rejection to the stable authorization code", async () => {
    const client = new CloudflareClient(
      "zone",
      "private-test-token",
      vi.fn(async () =>
        Response.json(
          { success: false, errors: [{ code: 9109, message: "forbidden" }] },
          { status: 403 },
        ),
      ),
    );

    try {
      await client.request("GET", "/rulesets");
      throw new Error("expected Cloudflare rejection");
    } catch (error) {
      expect(error).toBeInstanceOf(CloudflareProviderError);
      expect(error).toMatchObject({
        code: "CLOUDFLARE_AUTHORIZATION_ERROR",
        httpStatus: 403,
        providerCode: 9109,
      });
    }
  });
});
