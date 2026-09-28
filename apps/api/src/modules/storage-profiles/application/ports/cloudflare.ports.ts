import type { CloudflareRuleSnapshot } from "../../domain/cloudflare-rule-policy.js";

export type CloudflareDnsRecord = {
  id: string;
  type: string;
  name: string;
  content: string;
  proxied: boolean;
  comment: string | null;
};
export type CloudflarePhaseSnapshot = {
  rulesetId: string | null;
  rules: CloudflareRuleSnapshot[];
};
export type CloudflareRuleIdentity = { rulesetId: string; ruleId: string };
export type ManagedCloudflareRule = {
  ref: string;
  expression: string;
  action: string;
  actionParameters: Record<string, unknown>;
};

export interface CloudflareDnsPort {
  inspectHostname(hostname: string): Promise<CloudflareDnsRecord[]>;
  createManagedCname(input: {
    hostname: string;
    target: string;
    profileId: string;
  }): Promise<CloudflareDnsRecord>;
  updateManagedCname(input: {
    recordId: string;
    hostname: string;
    target: string;
    profileId: string;
  }): Promise<CloudflareDnsRecord>;
}

export interface CloudflareRulesPort {
  inspect(
    phase: "http_request_transform" | "http_request_cache_settings",
  ): Promise<CloudflarePhaseSnapshot>;
  create(
    phase: "http_request_transform" | "http_request_cache_settings",
    rule: ManagedCloudflareRule,
  ): Promise<CloudflareRuleIdentity>;
  update(
    phase: "http_request_transform" | "http_request_cache_settings",
    identity: CloudflareRuleIdentity,
    rule: ManagedCloudflareRule,
  ): Promise<CloudflareRuleIdentity>;
}

export interface CloudflareDeliveryProbePort {
  fetch(
    url: string,
  ): Promise<{ status: number; contentType: string | null; body: Uint8Array }>;
}
