import {
  blockingStorageProfileChecks,
  REQUIRED_STORAGE_PROFILE_CHECKS,
} from "../domain/storage-profile-readiness.js";
import type { StorageProfileReadinessRepository } from "./ports/storage-profile-readiness.ports.js";

export class StorageProfileReadinessService {
  constructor(
    private readonly repository: StorageProfileReadinessRepository,
    private readonly operationalMutationsEnabled: boolean,
  ) {}
  async get(profileId: string) {
    const profile = await this.repository.findById(profileId);
    if (!profile) return null;
    const checks = await this.repository.listChecks(profileId);
    const byType = new Map(checks.map((check) => [check.checkType, check]));
    const publicChecks = REQUIRED_STORAGE_PROFILE_CHECKS.map((type) => {
      const check = byType.get(type);
      return {
        type,
        status: check?.status ?? "pending",
        lastErrorCode: check?.lastErrorCode ?? null,
        metadata: check?.metadata ?? {},
        checkedAt: check?.checkedAt?.toISOString() ?? null,
        verifiedAt: check?.verifiedAt?.toISOString() ?? null,
      };
    });
    const blockingChecks = blockingStorageProfileChecks(checks);
    const eligible =
      profile.source === "env"
        ? profile.status === "retired"
        : (profile.status === "ready" || profile.status === "retired") &&
          blockingChecks.length === 0 &&
          profile.cloudflareProvisioningStatus === "verified" &&
          Boolean(
            profile.dnsRecordId &&
              profile.transformRuleId &&
              profile.cacheRuleId &&
              profile.b2DownloadHost,
          );
    return {
      profileId,
      overallStatus: profile.status,
      operationalMutationsEnabled: this.operationalMutationsEnabled,
      b2: {
        bucketIdConfigured: Boolean(profile.b2BucketId),
        downloadHostConfigured: Boolean(profile.b2DownloadHost),
        checks: publicChecks.filter((check) => check.type.startsWith("b2_")),
      },
      cloudflare: {
        provisioningStatus: profile.cloudflareProvisioningStatus,
        checks: publicChecks.filter((check) =>
          check.type.startsWith("cloudflare_"),
        ),
        lastErrorCode: profile.cloudflareLastErrorCode,
      },
      activation: { eligible, blockingChecks },
    };
  }

  async getPersistedCloudflareStatus(profileId: string) {
    const profile = await this.repository.findById(profileId);
    if (!profile) return null;
    return {
      provisioningStatus: profile.cloudflareProvisioningStatus,
      lastErrorCode: profile.cloudflareLastErrorCode,
      hostname: profile.publicHostname,
      providerInspectionAvailable: false as const,
    };
  }
}
