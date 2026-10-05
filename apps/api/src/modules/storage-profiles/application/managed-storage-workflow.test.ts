import { Readable } from "node:stream";
import {
  AesGcmSecretCipher,
  type ManagedStorageAdministrationResolver,
} from "@nodeprox/storage/profile-execution";
import { describe, expect, it, vi } from "vitest";
import type { StorageProfile } from "../domain/storage-profile.js";
import {
  blockingStorageProfileChecks,
  type StorageProfileCheck,
} from "../domain/storage-profile-readiness.js";
import { B2StorageProfileProvisioningService } from "./b2-storage-profile-provisioning.service.js";
import { CloudflareStorageProfileProvisioningService } from "./cloudflare-storage-profile-provisioning.service.js";
import type { B2BucketAdministrationPort } from "./ports/b2-administration.ports.js";
import type {
  CloudflareDnsPort,
  CloudflareRulesPort,
} from "./ports/cloudflare.ports.js";
import type { StorageProfileReadinessRepository } from "./ports/storage-profile-readiness.ports.js";
import { StorageProfileActivationService } from "./storage-profile-activation.service.js";
import { StorageProfileBrowserProbeService } from "./storage-profile-browser-probe.service.js";
import { StorageProfileReadinessService } from "./storage-profile-readiness.service.js";

describe("managed storage control-plane workflow with fake providers", () => {
  it("stays draft until B2, direct-browser and Cloudflare checks verify; then activates without provider calls", async () => {
    const cipher = new AesGcmSecretCipher(
      Buffer.alloc(32, 4).toString("base64"),
    );
    const profile: StorageProfile = {
      id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
      provider: "b2",
      source: "managed",
      status: "draft",
      name: "Managed",
      publicHostnameLabel: "manga",
      publicHostname: "manga.nodeprox.org",
      b2Endpoint: "https://s3.example.test",
      b2Region: "test",
      b2Bucket: "bucket",
      b2KeyId: "key",
      encryptedApplicationKey: cipher.encrypt("private-key"),
      credentialVersion: 1,
      b2BucketId: null,
      b2DownloadHost: null,
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
    const checks = new Map<string, StorageProfileCheck>();
    let session: {
      id: string;
      storageKey: string;
      expectedSha256: string;
      expectedSizeBytes: number;
      contentType: string;
      expiresAt: Date;
      status: "pending" | "checking" | "completed" | "failed" | "expired";
    } | null = null;
    let browserKey = "";
    const objects = new Map<string, Buffer>();
    const storage = {
      put: vi.fn(
        async (input: {
          key: string;
          body: { sizeBytes: number; open(): NodeJS.ReadableStream };
          contentType: string;
          sizeBytes: number;
        }) => {
          const chunks: Buffer[] = [];
          for await (const chunk of input.body.open())
            chunks.push(Buffer.from(chunk));
          objects.set(input.key, Buffer.concat(chunks));
          return {
            key: input.key,
            sizeBytes: input.sizeBytes,
            contentType: input.contentType,
          };
        },
      ),
      get: vi.fn(async (key: string) =>
        Readable.from(objects.get(key) ?? Buffer.alloc(0)),
      ),
      head: vi.fn(async (key: string) =>
        objects.has(key) ? { sizeBytes: objects.get(key)?.length ?? 0 } : null,
      ),
      exists: vi.fn(async (key: string) => objects.has(key)),
      delete: vi.fn(async (key: string) => {
        objects.delete(key);
      }),
    };
    const transfer = {
      initiate: vi.fn(async (input: { key: string }) => {
        browserKey = input.key;
        return {
          mode: "single" as const,
          method: "PUT" as const,
          url: "https://s3.example.test/signed",
          headers: { "Content-Type": "text/plain" },
          expiresAt: new Date(Date.now() + 300_000).toISOString(),
        };
      }),
    };
    const execution = {
      administrationStorageFor: vi.fn(async () => storage),
      administrationUploadTransferFor: vi.fn(async () => transfer),
    } as unknown as ManagedStorageAdministrationResolver;
    const repository = {
      findById: vi.fn(async () => profile),
      listChecks: vi.fn(async () => [...checks.values()]),
      upsertCheck: vi.fn(
        async (input: {
          profileId: string;
          type: string;
          status: StorageProfileCheck["status"];
          errorCode?: string;
          metadata?: Record<string, string>;
        }) => {
          checks.set(input.type, {
            id: input.type,
            profileId: input.profileId,
            checkType: input.type as StorageProfileCheck["checkType"],
            status: input.status,
            lastErrorCode: input.errorCode ?? null,
            metadata: input.metadata ?? {},
            checkedAt: new Date(),
            verifiedAt: input.status === "verified" ? new Date() : null,
            createdAt: new Date(),
            updatedAt: new Date(),
          });
        },
      ),
      persistB2Discovery: vi.fn(
        async (
          _id: string,
          fields: { bucketId: string; downloadHost: string },
        ) => {
          profile.b2BucketId = fields.bucketId;
          profile.b2DownloadHost = fields.downloadHost;
        },
      ),
      recomputeReadiness: vi.fn(async () => {
        if (
          blockingStorageProfileChecks([...checks.values()]).length === 0 &&
          profile.cloudflareProvisioningStatus === "verified"
        )
          profile.status = "ready";
      }),
      startCloudflareAttempt: vi.fn(async () => {
        profile.cloudflareProvisioningStatus = "provisioning";
        return ++profile.cloudflareProvisioningVersion;
      }),
      persistCloudflareIds: vi.fn(
        async (_id: string, _version: number, ids: Partial<StorageProfile>) =>
          Object.assign(profile, ids),
      ),
      finishCloudflareAttempt: vi.fn(
        async (
          _id: string,
          _version: number,
          result: { status: "verified" | "failed"; errorCode?: string },
        ) => {
          profile.cloudflareProvisioningStatus = result.status;
          profile.cloudflareLastErrorCode = result.errorCode ?? null;
        },
      ),
      listProvisionedManagedHostnames: vi.fn(async () => []),
      createProbeSession: vi.fn(
        async (input: Omit<NonNullable<typeof session>, "status">) => {
          session = { ...input, status: "pending" };
        },
      ),
      claimProbeSession: vi.fn(async () => {
        if (!session) return null;
        if (session.status === "pending") {
          session.status = "checking";
          return {
            state: "claimed" as const,
            storageKey: session.storageKey,
            expectedSha256: session.expectedSha256,
            expectedSizeBytes: session.expectedSizeBytes,
            contentType: session.contentType,
          };
        }
        return { state: session.status, storageKey: session.storageKey };
      }),
      expireProbeSessions: vi.fn(async () => []),
      completeProbeSession: vi.fn(
        async (_id: string, status: "completed" | "failed" | "expired") => {
          if (session) session.status = status;
        },
      ),
      activate: vi.fn(async () => {
        if (profile.status !== "ready") throw new Error("not-ready");
        profile.status = "active";
        return profile;
      }),
      recordAudit: vi.fn(async () => {}),
    } as unknown as StorageProfileReadinessRepository;
    const b2 = {
      inspect: vi.fn(async () => ({
        bucketId: "bucket-id",
        downloadHost: "f000.backblazeb2.com",
        public: true,
        revision: 1,
        corsRules: [],
        lifecycleRules: [],
      })),
      ensureNodeProxCors: vi.fn(async () => ({
        status: "verified" as const,
        metadata: {},
      })),
      ensureNodeProxLifecycle: vi.fn(async () => ({
        status: "verified" as const,
        metadata: {},
      })),
    } as unknown as B2BucketAdministrationPort;
    const dnsRecord = {
      id: "dns-id",
      type: "CNAME" as const,
      name: profile.publicHostname,
      content: "f000.backblazeb2.com",
      proxied: true,
      comment: `nodeprox-storage-profile:${profile.id}`,
    };
    const dns = {
      inspectHostname: vi.fn(async () => []),
      createManagedCname: vi.fn(async () => dnsRecord),
      updateManagedCname: vi.fn(async () => dnsRecord),
    } as unknown as CloudflareDnsPort;
    const rules = {
      inspect: vi.fn(async () => ({ rulesetId: "set-id", rules: [] })),
      create: vi.fn(async () => ({ rulesetId: "set-id", ruleId: "rule-id" })),
      update: vi.fn(async () => ({ rulesetId: "set-id", ruleId: "rule-id" })),
    } as unknown as CloudflareRulesPort;
    const delivery = {
      fetch: vi.fn(async () => ({
        status: 200,
        contentType: "text/plain",
        body: Buffer.from("nodeprox-cloudflare-delivery-probe-v1"),
      })),
    };
    const readiness = new StorageProfileReadinessService(repository, true);
    const b2Service = new B2StorageProfileProvisioningService(
      repository,
      b2,
      execution,
      cipher,
      ["https://app.nodeprox.org"],
      true,
    );
    const browser = new StorageProfileBrowserProbeService(
      repository,
      execution,
      true,
    );
    const cloudflare = new CloudflareStorageProfileProvisioningService(
      repository,
      dns,
      rules,
      rules,
      delivery,
      execution,
      true,
    );
    expect((await readiness.get(profile.id))?.activation.eligible).toBe(false);
    await b2Service.provision(profile.id);
    expect(profile.status).toBe("draft");
    const probe = await browser.start(profile.id);
    objects.set(browserKey, Buffer.from(probe.body)); // The fake browser writes directly to its signed B2 object.
    await browser.complete(profile.id, probe.probeId, "uploaded");
    expect(profile.status).toBe("draft");
    await cloudflare.provision(profile.id);
    expect(profile.status).toBe("ready");
    expect((await readiness.get(profile.id))?.activation.eligible).toBe(true);
    const providerCalls =
      vi.mocked(b2.inspect).mock.calls.length +
      vi.mocked(dns.createManagedCname).mock.calls.length;
    await new StorageProfileActivationService(repository, true).activate(
      profile.id,
      "actor-id",
    );
    expect(profile.status).toBe("active");
    expect(
      vi.mocked(b2.inspect).mock.calls.length +
        vi.mocked(dns.createManagedCname).mock.calls.length,
    ).toBe(providerCalls);
    expect(objects.size).toBe(0);
  });
});
