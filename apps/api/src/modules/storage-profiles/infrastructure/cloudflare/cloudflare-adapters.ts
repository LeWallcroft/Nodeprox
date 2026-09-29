import type {
  CloudflareDeliveryProbePort,
  CloudflareDnsPort,
  CloudflareDnsRecord,
  CloudflarePhaseSnapshot,
  CloudflareRuleIdentity,
  CloudflareRulesPort,
  ManagedCloudflareRule,
} from "../../application/ports/cloudflare.ports.js";

type Fetcher = typeof fetch;
type Envelope<T> = {
  success: boolean;
  result: T;
  errors?: Array<{ code?: number | string }>;
};

export class CloudflareProviderError extends Error {
  constructor(
    readonly code: string,
    readonly httpStatus?: number,
    readonly providerCode?: number,
  ) {
    super(code);
  }
}

function providerCodeFromEnvelope(value: unknown): number | undefined {
  if (!value || typeof value !== "object" || !("errors" in value))
    return undefined;
  const errors = (value as { errors?: unknown }).errors;
  if (!Array.isArray(errors)) return undefined;
  for (const error of errors) {
    if (!error || typeof error !== "object" || !("code" in error)) continue;
    const code = (error as { code?: unknown }).code;
    if (typeof code === "number" && Number.isSafeInteger(code) && code >= 0)
      return code;
    if (typeof code === "string" && /^\d{1,10}$/.test(code))
      return Number(code);
  }
  return undefined;
}

export class CloudflareClient {
  constructor(
    readonly zoneId: string,
    private readonly token: string,
    private readonly fetcher: Fetcher = fetch,
  ) {}

  async request<T>(
    method: string,
    path: string,
    body?: unknown,
    allowMissing = false,
  ): Promise<T | null> {
    let response: Response;
    try {
      response = await this.fetcher(
        `https://api.cloudflare.com/client/v4/zones/${encodeURIComponent(this.zoneId)}${path}`,
        {
          method,
          headers: {
            authorization: `Bearer ${this.token}`,
            "content-type": "application/json",
          },
          ...(body === undefined ? {} : { body: JSON.stringify(body) }),
          signal: AbortSignal.timeout(10_000),
        },
      );
    } catch {
      throw new CloudflareProviderError("CLOUDFLARE_PROVIDER_ERROR");
    }
    if (allowMissing && response.status === 404) return null;
    if (!response.ok) {
      let providerCode: number | undefined;
      try {
        providerCode = providerCodeFromEnvelope(await response.json());
      } catch {
        // Preserve the safe HTTP diagnosis even when the provider body is invalid.
      }
      if (response.status === 401 || response.status === 403)
        throw new CloudflareProviderError(
          "CLOUDFLARE_AUTHORIZATION_ERROR",
          response.status,
          providerCode,
        );
      throw new CloudflareProviderError(
        "CLOUDFLARE_PROVIDER_ERROR",
        response.status,
        providerCode,
      );
    }
    let envelope: Envelope<T>;
    try {
      envelope = (await response.json()) as Envelope<T>;
    } catch {
      throw new CloudflareProviderError("CLOUDFLARE_PROVIDER_ERROR");
    }
    if (!envelope.success)
      throw new CloudflareProviderError(
        "CLOUDFLARE_PROVIDER_ERROR",
        response.status,
        providerCodeFromEnvelope(envelope),
      );
    return envelope.result;
  }
}

export class CloudflareDnsAdapter implements CloudflareDnsPort {
  constructor(private readonly client: CloudflareClient) {}
  async inspectHostname(hostname: string): Promise<CloudflareDnsRecord[]> {
    return (
      (await this.client.request<CloudflareDnsRecord[]>(
        "GET",
        `/dns_records?name=${encodeURIComponent(hostname)}&per_page=100`,
      )) ?? []
    );
  }
  async createManagedCname(input: {
    hostname: string;
    target: string;
    profileId: string;
  }): Promise<CloudflareDnsRecord> {
    const record = await this.client.request<CloudflareDnsRecord>(
      "POST",
      "/dns_records",
      {
        type: "CNAME",
        name: input.hostname,
        content: input.target,
        proxied: true,
        ttl: 1,
        comment: `nodeprox-storage-profile:${input.profileId}`,
      },
    );
    if (!record) throw new CloudflareProviderError("CLOUDFLARE_PROVIDER_ERROR");
    return record;
  }
  async updateManagedCname(input: {
    recordId: string;
    hostname: string;
    target: string;
    profileId: string;
  }): Promise<CloudflareDnsRecord> {
    const record = await this.client.request<CloudflareDnsRecord>(
      "PATCH",
      `/dns_records/${encodeURIComponent(input.recordId)}`,
      {
        type: "CNAME",
        name: input.hostname,
        content: input.target,
        proxied: true,
        ttl: 1,
        comment: `nodeprox-storage-profile:${input.profileId}`,
      },
    );
    if (!record) throw new CloudflareProviderError("CLOUDFLARE_PROVIDER_ERROR");
    return record;
  }
}

type ProviderRuleset = {
  id: string;
  rules?: Array<{
    id: string;
    ref?: string;
    expression: string;
    enabled?: boolean;
    action: string;
    action_parameters?: Record<string, unknown>;
  }>;
};

export class CloudflareRulesAdapter implements CloudflareRulesPort {
  constructor(private readonly client: CloudflareClient) {}
  async inspect(
    phase: "http_request_transform" | "http_request_cache_settings",
  ): Promise<CloudflarePhaseSnapshot> {
    const result = await this.client.request<ProviderRuleset>(
      "GET",
      `/rulesets/phases/${phase}/entrypoint`,
      undefined,
      true,
    );
    return {
      rulesetId: result?.id ?? null,
      rules: (result?.rules ?? []).map((rule) => ({
        id: rule.id,
        ref: rule.ref ?? null,
        expression: rule.expression,
        enabled: rule.enabled !== false,
        action: rule.action,
        ...(rule.action_parameters
          ? { actionParameters: rule.action_parameters }
          : {}),
      })),
    };
  }
  async create(
    phase: "http_request_transform" | "http_request_cache_settings",
    rule: ManagedCloudflareRule,
  ): Promise<CloudflareRuleIdentity> {
    const snapshot = await this.inspect(phase);
    const body = {
      ref: rule.ref,
      expression: rule.expression,
      action: rule.action,
      action_parameters: rule.actionParameters,
      enabled: true,
    };
    if (!snapshot.rulesetId) {
      const result = await this.client.request<ProviderRuleset>(
        "POST",
        "/rulesets",
        { name: `NodeProx ${phase}`, kind: "zone", phase, rules: [body] },
      );
      const id = result?.rules?.[0]?.id;
      if (!result || !id)
        throw new CloudflareProviderError("CLOUDFLARE_PROVIDER_ERROR");
      return { rulesetId: result.id, ruleId: id };
    }
    const result = await this.client.request<ProviderRuleset>(
      "POST",
      `/rulesets/${encodeURIComponent(snapshot.rulesetId)}/rules`,
      body,
    );
    const id = result?.rules?.find((item) => item.ref === rule.ref)?.id;
    if (!id) throw new CloudflareProviderError("CLOUDFLARE_PROVIDER_ERROR");
    return { rulesetId: snapshot.rulesetId, ruleId: id };
  }
  async update(
    _phase: "http_request_transform" | "http_request_cache_settings",
    identity: CloudflareRuleIdentity,
    rule: ManagedCloudflareRule,
  ): Promise<CloudflareRuleIdentity> {
    await this.client.request(
      "PATCH",
      `/rulesets/${encodeURIComponent(identity.rulesetId)}/rules/${encodeURIComponent(identity.ruleId)}`,
      {
        ref: rule.ref,
        expression: rule.expression,
        action: rule.action,
        action_parameters: rule.actionParameters,
        enabled: true,
      },
    );
    return identity;
  }
}

export class CloudflareDeliveryProbeAdapter
  implements CloudflareDeliveryProbePort
{
  constructor(private readonly fetcher: Fetcher = fetch) {}
  async fetch(url: string) {
    let response: Response;
    try {
      response = await this.fetcher(url, {
        signal: AbortSignal.timeout(10_000),
      });
    } catch {
      throw new CloudflareProviderError("CLOUDFLARE_DELIVERY_PROBE_FAILED");
    }
    return {
      status: response.status,
      contentType: response.headers.get("content-type"),
      body: new Uint8Array(await response.arrayBuffer()),
    };
  }
}
