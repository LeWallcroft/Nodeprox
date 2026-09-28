import { Readable } from "node:stream";
import { describe, expect, it, vi } from "vitest";
import type { StoragePort } from "@nodeprox/storage/port";
import type { ManagedStorageAdministrationResolver } from "@nodeprox/storage/profile-execution";
import { CloudflareStorageProfileProvisioningService } from "./cloudflare-storage-profile-provisioning.service.js";
import type { StorageProfileReadinessRepository } from "./ports/storage-profile-readiness.ports.js";
import type {
  CloudflareDnsPort,
  CloudflareRulesPort,
} from "./ports/cloudflare.ports.js";
import type { StorageProfile } from "../domain/storage-profile.js";

function fixture() {
  const profile: StorageProfile = {
    id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
    provider: "b2",
    source: "managed",
    status: "draft",
    name: "Manga",
    publicHostnameLabel: "manga",
    publicHostname: "manga.nodeprox.org",
    b2Endpoint: "https://s3.example.test",
    b2Region: "us-west-000",
    b2Bucket: "nodeprox",
    b2KeyId: "key-id",
    encryptedApplicationKey: "cipher",
    credentialVersion: 1,
    b2BucketId: "bucket-id",
    b2DownloadHost: "f000.backblazeb2.com",
    dnsRecordId: null,
    transformRulesetId: null,
    transformRuleId: null,
    cacheRulesetId: null,
    cacheRuleId: null,
    cloudflareProvisioningVersion: 0,
    cloudflareProvisioningStatus: "pending",
    cloudflareLastErrorCode: null,
    cloudflareProvisioningStartedAt: null,
    cloudflareVerifiedAt: null,
    readyAt: null,
    activatedAt: null,
    retiredAt: null,
    createdAt: new Date(),
    updatedAt: new Date(),
  };
  const state = {
    dns: [] as Awaited<ReturnType<CloudflareDnsPort["inspectHostname"]>>,
    transform: [] as Awaited<
      ReturnType<CloudflareRulesPort["inspect"]>
    >["rules"],
    cache: [] as Awaited<ReturnType<CloudflareRulesPort["inspect"]>>["rules"],
  };
  const repository = {
    findById: vi.fn(async () => profile),
    startCloudflareAttempt: vi.fn(async () => 1),
    persistCloudflareIds: vi.fn(
      async (_id: string, _version: number, ids: Record<string, string>) =>
        Object.assign(profile, ids),
    ),
    upsertCheck: vi.fn(async () => {}),
    finishCloudflareAttempt: vi.fn(async () => {}),
    recomputeReadiness: vi.fn(async () => {}),
    listProvisionedManagedHostnames: vi.fn(async () => []),
  } as unknown as StorageProfileReadinessRepository;
  const dns: CloudflareDnsPort = {
    inspectHostname: vi.fn(async (hostname) =>
      state.dns.filter((record) => record.name === hostname),
    ),
    createManagedCname: vi.fn(async (input) => {
      const record = {
        id: `dns-${input.profileId}`,
        type: "CNAME",
        name: input.hostname,
        content: input.target,
        proxied: true,
        comment: `nodeprox-storage-profile:${input.profileId}`,
      };
      state.dns.push(record);
      return record;
    }),
    updateManagedCname: vi.fn(async (input) => ({
      id: input.recordId,
      type: "CNAME",
      name: input.hostname,
      content: input.target,
      proxied: true,
      comment: `nodeprox-storage-profile:${input.profileId}`,
    })),
  };
  const rules: CloudflareRulesPort = {
    inspect: vi.fn(async (phase) => ({
      rulesetId:
        phase === "http_request_transform" ? "transform-set" : "cache-set",
      rules: phase === "http_request_transform" ? state.transform : state.cache,
    })),
    create: vi.fn(async (phase, rule) => {
      const item = {
        id: `${phase}-rule`,
        ref: rule.ref,
        expression: rule.expression,
        enabled: true,
        action: rule.action,
      };
      (phase === "http_request_transform" ? state.transform : state.cache).push(
        item,
      );
      return {
        rulesetId:
          phase === "http_request_transform" ? "transform-set" : "cache-set",
        ruleId: item.id,
      };
    }),
    update: vi.fn(async (_phase, identity) => identity),
  };
  const storage: StoragePort = {
    put: vi.fn(async (input) => ({
      key: input.key,
      sizeBytes: input.sizeBytes,
      contentType: input.contentType,
    })),
    get: vi.fn(async () => Readable.from("")),
    delete: vi.fn(async () => {}),
    exists: vi.fn(async () => false),
  };
  const execution = {
    administrationStorageFor: vi.fn(async () => storage),
  } as unknown as ManagedStorageAdministrationResolver;
  const delivery = {
    fetch: vi.fn(async () => ({
      status: 200,
      contentType: "text/plain",
      body: Buffer.from("nodeprox-cloudflare-delivery-probe-v1"),
    })),
  };
  const service = new CloudflareStorageProfileProvisioningService(
    repository,
    dns,
    rules,
    rules,
    delivery,
    execution,
    true,
  );
  return { profile, state, repository, dns, rules, storage, delivery, service };
}

describe("Cloudflare managed provisioning", () => {
  it("provisions owned DNS and exact rules, then reconciles retry without duplicate resources", async () => {
    const f = fixture();
    await f.service.provision(f.profile.id);
    await f.service.provision(f.profile.id);
    expect(f.dns.createManagedCname).toHaveBeenCalledTimes(1);
    expect(f.state.transform).toHaveLength(1);
    expect(f.state.cache).toHaveLength(1);
    expect(f.storage.delete).toHaveBeenCalledTimes(2);
  });
  it("rejects foreign DNS without provider mutation", async () => {
    const f = fixture();
    f.state.dns = [
      {
        id: "foreign",
        type: "CNAME",
        name: f.profile.publicHostname,
        content: f.profile.b2DownloadHost ?? "",
        proxied: true,
        comment: null,
      },
    ];
    await expect(f.service.provision(f.profile.id)).rejects.toThrow(
      "CLOUDFLARE_DNS_CONFLICT",
    );
    expect(f.dns.createManagedCname).not.toHaveBeenCalled();
    expect(f.rules.create).not.toHaveBeenCalled();
  });
  it("checks capacity before creating any DNS resource", async () => {
    const f = fixture();
    f.state.transform = Array.from({ length: 10 }, (_, index) => ({
      id: String(index),
      ref: null,
      expression: 'http.host eq "media.nodeprox.org"',
      enabled: true,
      action: "rewrite",
    }));
    await expect(f.service.provision(f.profile.id)).rejects.toThrow(
      "CLOUDFLARE_RULE_CAPACITY_EXHAUSTED",
    );
    expect(f.dns.createManagedCname).not.toHaveBeenCalled();
  });
  it("preserves legacy exact-host rules while rejecting broad foreign cache behavior", async () => {
    const f = fixture();
    f.state.transform.push({
      id: "legacy",
      ref: "legacy",
      expression: 'http.host eq "media.nodeprox.org"',
      enabled: true,
      action: "rewrite",
    });
    f.state.cache.push({
      id: "legacy-cache",
      ref: "media-cache",
      expression: 'http.host eq "media.nodeprox.org"',
      enabled: true,
      action: "set_cache_settings",
    });
    await f.service.provision(f.profile.id);
    expect(f.state.transform[0]?.id).toBe("legacy");
    expect(f.state.cache[0]?.id).toBe("legacy-cache");
    const g = fixture();
    g.state.cache.push({
      id: "foreign",
      ref: "foreign",
      expression: "true",
      enabled: true,
      action: "set_cache_settings",
    });
    await expect(g.service.provision(g.profile.id)).rejects.toThrow(
      "CLOUDFLARE_RULE_CONFLICT",
    );
  });
  it("retains an already provisioned retired host in one shared cache rule", async () => {
    const f = fixture();
    await f.service.provision(f.profile.id);
    const firstHost = f.profile.publicHostname;
    vi.mocked(f.repository.listProvisionedManagedHostnames).mockResolvedValue([
      firstHost,
    ]);
    f.profile.id = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
    f.profile.publicHostname = "second.nodeprox.org";
    f.profile.publicHostnameLabel = "second";
    f.profile.dnsRecordId = null;
    f.profile.transformRuleId = null;
    f.profile.cacheRuleId = null;
    await f.service.provision(f.profile.id);
    expect(f.state.cache).toHaveLength(1);
    expect(f.rules.update).toHaveBeenCalledWith(
      "http_request_cache_settings",
      expect.anything(),
      expect.objectContaining({
        expression: expect.stringContaining(firstHost),
      }),
    );
    expect(
      vi.mocked(f.rules.update).mock.calls.at(-1)?.[2].expression,
    ).toContain("second.nodeprox.org");
  });
  it("reconciles IDs after delivery failure and retries without duplicate provider resources", async () => {
    const f = fixture();
    vi.mocked(f.delivery.fetch).mockRejectedValueOnce(
      new Error("CLOUDFLARE_DELIVERY_PROBE_FAILED"),
    );
    await expect(f.service.provision(f.profile.id)).rejects.toThrow(
      "CLOUDFLARE_DELIVERY_PROBE_FAILED",
    );
    expect(f.repository.finishCloudflareAttempt).toHaveBeenCalledWith(
      f.profile.id,
      1,
      expect.objectContaining({ status: "failed" }),
    );
    await f.service.provision(f.profile.id);
    expect(f.dns.createManagedCname).toHaveBeenCalledTimes(1);
    expect(f.state.transform).toHaveLength(1);
    expect(f.state.cache).toHaveLength(1);
  });
});
