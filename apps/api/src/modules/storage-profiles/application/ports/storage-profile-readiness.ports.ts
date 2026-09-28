import type { StorageProfile } from "../../domain/storage-profile.js";
import type {
  StorageProfileCheck,
  StorageProfileCheckStatus,
  StorageProfileCheckType,
} from "../../domain/storage-profile-readiness.js";

export interface StorageProfileReadinessRepository {
  findById(id: string): Promise<StorageProfile | null>;
  listChecks(profileId: string): Promise<StorageProfileCheck[]>;
  upsertCheck(input: {
    profileId: string;
    type: StorageProfileCheckType;
    status: StorageProfileCheckStatus;
    errorCode?: string | null;
    metadata?: Record<string, unknown>;
  }): Promise<void>;
  startCloudflareAttempt(profileId: string): Promise<number>;
  persistCloudflareIds(
    profileId: string,
    version: number,
    ids: {
      dnsRecordId?: string;
      transformRulesetId?: string;
      transformRuleId?: string;
      cacheRulesetId?: string;
      cacheRuleId?: string;
    },
  ): Promise<void>;
  finishCloudflareAttempt(
    profileId: string,
    version: number,
    result: { status: "verified" | "failed"; errorCode?: string },
  ): Promise<void>;
  listProvisionedManagedHostnames(): Promise<string[]>;
  recomputeReadiness(profileId: string): Promise<void>;
  persistB2Discovery(
    profileId: string,
    fields: { bucketId: string; downloadHost: string },
  ): Promise<void>;
  activate(
    profileId: string,
    actorId: string,
    requestId?: string,
  ): Promise<StorageProfile>;
  createProbeSession(input: {
    id: string;
    profileId: string;
    storageKey: string;
    expectedSha256: string;
    expectedSizeBytes: number;
    contentType: string;
    expiresAt: Date;
  }): Promise<void>;
  claimProbeSession(
    profileId: string,
    probeId: string,
  ): Promise<
    | {
        state: "claimed";
        storageKey: string;
        expectedSha256: string;
        expectedSizeBytes: number;
        contentType: string;
      }
    | { state: "completed"; storageKey: string }
    | { state: "failed"; storageKey: string }
    | { state: "expired"; storageKey: string }
    | { state: "checking"; storageKey: string }
    | null
  >;
  expireProbeSessions(
    profileId: string,
  ): Promise<Array<{ id: string; storageKey: string }>>;
  completeProbeSession(
    probeId: string,
    status: "completed" | "failed" | "expired",
  ): Promise<void>;
  rotateCredentials(input: {
    profileId: string;
    b2KeyId: string;
    encryptedApplicationKey: string;
    actorId: string;
    requestId?: string;
  }): Promise<StorageProfile>;
  recordAudit?(input: {
    profileId: string;
    action: string;
    actorId?: string;
    requestId?: string;
    result: "success" | "failed";
    reasonCode?: string;
  }): Promise<void>;
}
