import { randomUUID } from "node:crypto";
import { Readable } from "node:stream";
import type { ManagedStorageAdministrationResolver } from "@nodeprox/storage/profile-execution";
import {
  assertNoForeignRuleConflict,
  assertRuleCapacity,
  MANAGED_CACHE_RULE_REF,
  managedCacheExpression,
  managedCacheParameters,
  transformRuleExpression,
  transformRuleParameters,
  transformRuleRef,
} from "../domain/cloudflare-rule-policy.js";
import type { StorageProfile } from "../domain/storage-profile.js";
import type {
  CloudflareDeliveryProbePort,
  CloudflareDnsPort,
  CloudflareRulesPort,
  ManagedCloudflareRule,
} from "./ports/cloudflare.ports.js";
import type { StorageProfileReadinessRepository } from "./ports/storage-profile-readiness.ports.js";

type Phase = "http_request_transform" | "http_request_cache_settings";
const TRANSFORM: Phase = "http_request_transform";
const CACHE: Phase = "http_request_cache_settings";

export class StorageManagedOperationsDisabledError extends Error {
  constructor() {
    super("storage-managed-operations-disabled");
  }
}

export class CloudflareProvisioningError extends Error {
  constructor(readonly code: string) {
    super(code);
  }
}

function providerFailure(error: unknown): string {
  if (error instanceof Error && "code" in error) {
    const providerError = error as Error & {
      code?: unknown;
      httpStatus?: unknown;
      providerCode?: unknown;
    };
    if (typeof providerError.code === "string") {
      if (providerError.code === "CLOUDFLARE_AUTHORIZATION_ERROR")
        return providerError.code;
      if (/^[A-Z][A-Z0-9_]+$/.test(providerError.code)) {
        const status =
          typeof providerError.httpStatus === "number" &&
          Number.isInteger(providerError.httpStatus)
            ? `_HTTP_${providerError.httpStatus}`
            : "";
        const providerCode =
          typeof providerError.providerCode === "number" &&
          Number.isSafeInteger(providerError.providerCode) &&
          providerError.providerCode >= 0
            ? `_CF_${providerError.providerCode}`
            : "";
        return `${providerError.code}${status}${providerCode}`;
      }
    }
  }
  if (error instanceof Error && /^[A-Z][A-Z0-9_]+$/.test(error.message))
    return error.message;
  return "CLOUDFLARE_PROVIDER_ERROR";
}

export class CloudflareStorageProfileProvisioningService {
  constructor(
    private readonly repository: StorageProfileReadinessRepository,
    private readonly dns: CloudflareDnsPort,
    private readonly transform: CloudflareRulesPort,
    private readonly cache: CloudflareRulesPort,
    private readonly delivery: CloudflareDeliveryProbePort,
    private readonly storageExecution: ManagedStorageAdministrationResolver,
    private readonly enabled: boolean,
  ) {}

  async status(profileId: string, inspectProvider = true) {
    const profile = await this.repository.findById(profileId);
    if (!profile) return null;
    if (!inspectProvider)
      return {
        provisioningStatus: profile.cloudflareProvisioningStatus,
        lastErrorCode: profile.cloudflareLastErrorCode,
        hostname: profile.publicHostname,
        providerInspectionAvailable: false,
      };
    let transform: Awaited<ReturnType<CloudflareRulesPort["inspect"]>>;
    let cache: Awaited<ReturnType<CloudflareRulesPort["inspect"]>>;
    try {
      [transform, cache] = await Promise.all([
        this.transform.inspect(TRANSFORM),
        this.cache.inspect(CACHE),
      ]);
    } catch (error) {
      throw new CloudflareProvisioningError(providerFailure(error));
    }
    return {
      provisioningStatus: profile.cloudflareProvisioningStatus,
      lastErrorCode: profile.cloudflareLastErrorCode,
      hostname: profile.publicHostname,
      providerInspectionAvailable: true,
      transform: {
        configured: Boolean(profile.transformRuleId),
        used: transform.rules.length,
        limit: 10,
      },
      cache: {
        configured: Boolean(profile.cacheRuleId),
        used: cache.rules.length,
        limit: 10,
      },
    };
  }

  async provision(
    profileId: string,
    actorId?: string,
    requestId?: string,
  ): Promise<void> {
    if (!this.enabled) throw new StorageManagedOperationsDisabledError();
    const profile = await this.repository.findById(profileId);
    if (
      profile?.source !== "managed" ||
      !profile.b2DownloadHost ||
      !profile.b2Bucket
    )
      throw new CloudflareProvisioningError("B2_DOWNLOAD_HOST_REQUIRED");
    const version = await this.repository.startCloudflareAttempt(profileId);
    await this.repository.recordAudit?.({
      profileId,
      action: "storage.profile.cloudflare.provision.started",
      result: "success",
      ...(actorId ? { actorId } : {}),
      ...(requestId ? { requestId } : {}),
    });
    let failedCheck:
      | "cloudflare_dns"
      | "cloudflare_transform"
      | "cloudflare_cache"
      | "cloudflare_delivery"
      | null = "cloudflare_dns";
    try {
      for (const type of [
        "cloudflare_dns",
        "cloudflare_transform",
        "cloudflare_cache",
        "cloudflare_delivery",
      ] as const) {
        await this.repository.upsertCheck({
          profileId,
          type,
          status: "pending",
        });
      }

      const ref = transformRuleRef(profile.id);
      failedCheck = "cloudflare_transform";
      const transformPhase = await this.transform.inspect(TRANSFORM);
      this.assertTransformOwnership(profile, transformPhase);
      failedCheck = "cloudflare_cache";
      const cachePhase = await this.cache.inspect(CACHE);
      this.assertCacheOwnership(profile, cachePhase);

      failedCheck = "cloudflare_dns";
      const records = await this.dns.inspectHostname(profile.publicHostname);
      this.assertDnsOwnership(profile, records);
      const dnsRecord =
        records[0] ??
        (await this.dns.createManagedCname({
          hostname: profile.publicHostname,
          target: profile.b2DownloadHost,
          profileId: profile.id,
        }));
      if (dnsRecord.content !== profile.b2DownloadHost || !dnsRecord.proxied) {
        const updated = await this.dns.updateManagedCname({
          recordId: dnsRecord.id,
          hostname: profile.publicHostname,
          target: profile.b2DownloadHost,
          profileId: profile.id,
        });
        await this.repository.persistCloudflareIds(profile.id, version, {
          dnsRecordId: updated.id,
        });
      } else
        await this.repository.persistCloudflareIds(profile.id, version, {
          dnsRecordId: dnsRecord.id,
        });
      await this.repository.upsertCheck({
        profileId,
        type: "cloudflare_dns",
        status: "verified",
      });

      failedCheck = "cloudflare_transform";
      const rule: ManagedCloudflareRule = {
        ref,
        expression: transformRuleExpression(profile.publicHostname),
        action: "rewrite",
        actionParameters: transformRuleParameters(profile.b2Bucket),
      };
      const existingTransform = transformPhase.rules.find(
        (item) => item.ref === ref,
      );
      const transformIdentity =
        existingTransform && transformPhase.rulesetId
          ? await this.transform.update(
              TRANSFORM,
              {
                rulesetId: transformPhase.rulesetId,
                ruleId: existingTransform.id,
              },
              rule,
            )
          : await this.transform.create(TRANSFORM, rule);
      await this.repository.persistCloudflareIds(profile.id, version, {
        transformRulesetId: transformIdentity.rulesetId,
        transformRuleId: transformIdentity.ruleId,
      });
      await this.repository.upsertCheck({
        profileId,
        type: "cloudflare_transform",
        status: "verified",
        metadata: { transformRuleRef: ref },
      });

      failedCheck = "cloudflare_cache";
      const hosts = await this.repository.listProvisionedManagedHostnames();
      const cacheRule: ManagedCloudflareRule = {
        ref: MANAGED_CACHE_RULE_REF,
        expression: managedCacheExpression([...hosts, profile.publicHostname]),
        action: "set_cache_settings",
        actionParameters: managedCacheParameters(),
      };
      const existingCache = cachePhase.rules.find(
        (item) => item.ref === MANAGED_CACHE_RULE_REF,
      );
      const cacheIdentity =
        existingCache && cachePhase.rulesetId
          ? await this.cache.update(
              CACHE,
              { rulesetId: cachePhase.rulesetId, ruleId: existingCache.id },
              cacheRule,
            )
          : await this.cache.create(CACHE, cacheRule);
      await this.repository.persistCloudflareIds(profile.id, version, {
        cacheRulesetId: cacheIdentity.rulesetId,
        cacheRuleId: cacheIdentity.ruleId,
      });
      await this.repository.upsertCheck({
        profileId,
        type: "cloudflare_cache",
        status: "verified",
      });
      failedCheck = "cloudflare_delivery";
      await this.probe(profile);
      failedCheck = null;
      await this.repository.upsertCheck({
        profileId,
        type: "cloudflare_delivery",
        status: "verified",
        metadata: { probeTimestamp: new Date().toISOString() },
      });
      await this.repository.finishCloudflareAttempt(profileId, version, {
        status: "verified",
      });
      await this.repository.recomputeReadiness(profileId);
      await this.repository.recordAudit?.({
        profileId,
        action: "storage.profile.cloudflare.provision.completed",
        result: "success",
        ...(actorId ? { actorId } : {}),
        ...(requestId ? { requestId } : {}),
      });
    } catch (error) {
      const code = providerFailure(error);
      await this.repository.finishCloudflareAttempt(profileId, version, {
        status: "failed",
        errorCode: code,
      });
      if (failedCheck)
        await this.repository.upsertCheck({
          profileId,
          type: failedCheck,
          status: "failed",
          errorCode: code,
        });
      await this.repository.recomputeReadiness(profileId);
      await this.repository.recordAudit?.({
        profileId,
        action: "storage.profile.cloudflare.provision.failed",
        result: "failed",
        reasonCode: code,
        ...(actorId ? { actorId } : {}),
        ...(requestId ? { requestId } : {}),
      });
      throw new CloudflareProvisioningError(code);
    }
  }

  private assertDnsOwnership(
    profile: StorageProfile,
    records: Awaited<ReturnType<CloudflareDnsPort["inspectHostname"]>>,
  ) {
    const marker = `nodeprox-storage-profile:${profile.id}`;
    if (
      records.length > 1 ||
      records.some(
        (record) =>
          record.name !== profile.publicHostname ||
          record.type !== "CNAME" ||
          (record.id !== profile.dnsRecordId && record.comment !== marker),
      )
    )
      throw new CloudflareProvisioningError("CLOUDFLARE_DNS_CONFLICT");
  }

  private assertTransformOwnership(
    profile: StorageProfile,
    transformPhase: Awaited<ReturnType<CloudflareRulesPort["inspect"]>>,
  ) {
    const ref = transformRuleRef(profile.id);
    const ownedTransform = transformPhase.rules.find(
      (rule) => rule.ref === ref,
    );
    if (
      profile.transformRuleId &&
      ownedTransform?.id !== profile.transformRuleId
    )
      throw new CloudflareProvisioningError("CLOUDFLARE_RULE_CONFLICT");
    assertNoForeignRuleConflict(
      transformPhase.rules,
      profile.publicHostname,
      ref,
      "transform",
    );
    assertRuleCapacity(transformPhase.rules, ref);
  }

  private assertCacheOwnership(
    profile: StorageProfile,
    cachePhase: Awaited<ReturnType<CloudflareRulesPort["inspect"]>>,
  ) {
    if (
      profile.cacheRuleId &&
      cachePhase.rules.find((rule) => rule.ref === MANAGED_CACHE_RULE_REF)
        ?.id !== profile.cacheRuleId
    )
      throw new CloudflareProvisioningError("CLOUDFLARE_RULE_CONFLICT");
    assertNoForeignRuleConflict(
      cachePhase.rules,
      profile.publicHostname,
      MANAGED_CACHE_RULE_REF,
      "cache",
    );
    assertRuleCapacity(cachePhase.rules, MANAGED_CACHE_RULE_REF);
  }

  private async probe(profile: StorageProfile) {
    const key = `Media/nodeprox-probe/${randomUUID()}.txt`;
    const body = Buffer.from("nodeprox-cloudflare-delivery-probe-v1");
    const storage = await this.storageExecution.administrationStorageFor(
      profile.id,
    );
    try {
      await storage.put({
        key,
        body: Readable.from(body),
        contentType: "text/plain",
        sizeBytes: body.length,
      });
      const response = await this.delivery.fetch(
        `https://${profile.publicHostname}/${key.slice("Media/".length)}`,
      );
      if (
        response.status !== 200 ||
        !response.contentType?.startsWith("text/plain") ||
        !Buffer.from(response.body).equals(body)
      )
        throw new CloudflareProvisioningError(
          "CLOUDFLARE_DELIVERY_PROBE_FAILED",
        );
    } finally {
      await storage.delete(key);
    }
  }
}
