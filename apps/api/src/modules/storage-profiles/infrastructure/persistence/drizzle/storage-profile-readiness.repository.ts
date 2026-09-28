import { and, eq, sql } from "drizzle-orm";
import type { NodeProxDatabase } from "../../../../../../../../database/client.js";
import {
  auditLogs,
  storageProfileChecks,
  storageProfileProbeSessions,
  storageProfiles,
} from "../../../../../../../../database/schema/index.js";
import type { StorageProfileReadinessRepository } from "../../../application/ports/storage-profile-readiness.ports.js";
import {
  blockingStorageProfileChecks,
  safeReadinessMetadata,
} from "../../../domain/storage-profile-readiness.js";

export class StorageProfileStateConflictError extends Error {
  constructor(readonly code = "storage-profile-conflict") {
    super(code);
  }
}

export class DrizzleStorageProfileReadinessRepository
  implements StorageProfileReadinessRepository
{
  constructor(private readonly db: NodeProxDatabase) {}
  async findById(id: string) {
    return (
      (
        await this.db
          .select()
          .from(storageProfiles)
          .where(eq(storageProfiles.id, id))
          .limit(1)
      )[0] ?? null
    );
  }
  async listChecks(profileId: string) {
    return this.db
      .select()
      .from(storageProfileChecks)
      .where(eq(storageProfileChecks.profileId, profileId));
  }
  async upsertCheck(
    input: Parameters<StorageProfileReadinessRepository["upsertCheck"]>[0],
  ) {
    const now = new Date();
    await this.db
      .insert(storageProfileChecks)
      .values({
        profileId: input.profileId,
        checkType: input.type,
        status: input.status,
        lastErrorCode: input.errorCode ?? null,
        metadata: safeReadinessMetadata(input.metadata ?? {}),
        checkedAt: now,
        verifiedAt: input.status === "verified" ? now : null,
        updatedAt: now,
      })
      .onConflictDoUpdate({
        target: [
          storageProfileChecks.profileId,
          storageProfileChecks.checkType,
        ],
        set: {
          status: input.status,
          lastErrorCode: input.errorCode ?? null,
          metadata: safeReadinessMetadata(input.metadata ?? {}),
          checkedAt: now,
          verifiedAt: input.status === "verified" ? now : null,
          updatedAt: now,
        },
      });
  }
  async startCloudflareAttempt(profileId: string): Promise<number> {
    return this.db.transaction(async (tx) => {
      const [profile] = await tx
        .select()
        .from(storageProfiles)
        .where(eq(storageProfiles.id, profileId))
        .for("update")
        .limit(1);
      if (
        profile?.source !== "managed" ||
        !profile.b2DownloadHost ||
        !profile.b2Bucket
      )
        throw new StorageProfileStateConflictError("B2_DOWNLOAD_HOST_REQUIRED");
      if (
        profile.cloudflareProvisioningStatus === "provisioning" &&
        profile.cloudflareProvisioningStartedAt &&
        Date.now() - profile.cloudflareProvisioningStartedAt.getTime() < 300_000
      )
        throw new StorageProfileStateConflictError();
      const version = profile.cloudflareProvisioningVersion + 1;
      await tx
        .update(storageProfiles)
        .set({
          cloudflareProvisioningVersion: version,
          cloudflareProvisioningStatus: "provisioning",
          cloudflareProvisioningStartedAt: new Date(),
          cloudflareLastErrorCode: null,
          updatedAt: new Date(),
        })
        .where(eq(storageProfiles.id, profileId));
      return version;
    });
  }
  async persistCloudflareIds(
    profileId: string,
    version: number,
    ids: Parameters<
      StorageProfileReadinessRepository["persistCloudflareIds"]
    >[2],
  ) {
    const updated = await this.db
      .update(storageProfiles)
      .set({ ...ids, updatedAt: new Date() })
      .where(
        and(
          eq(storageProfiles.id, profileId),
          eq(storageProfiles.cloudflareProvisioningVersion, version),
        ),
      )
      .returning({ id: storageProfiles.id });
    if (!updated[0]) throw new StorageProfileStateConflictError();
  }
  async finishCloudflareAttempt(
    profileId: string,
    version: number,
    result: { status: "verified" | "failed"; errorCode?: string },
  ) {
    const updated = await this.db
      .update(storageProfiles)
      .set({
        cloudflareProvisioningStatus: result.status,
        cloudflareLastErrorCode: result.errorCode ?? null,
        cloudflareVerifiedAt: result.status === "verified" ? new Date() : null,
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(storageProfiles.id, profileId),
          eq(storageProfiles.cloudflareProvisioningVersion, version),
        ),
      )
      .returning({ id: storageProfiles.id });
    if (!updated[0]) throw new StorageProfileStateConflictError();
  }
  async listProvisionedManagedHostnames() {
    const rows = await this.db
      .select({ hostname: storageProfiles.publicHostname })
      .from(storageProfiles)
      .where(
        and(
          eq(storageProfiles.source, "managed"),
          eq(storageProfiles.cloudflareProvisioningStatus, "verified"),
        ),
      );
    return rows.map((row) => row.hostname);
  }
  async recomputeReadiness(profileId: string) {
    await this.db.transaction(async (tx) => {
      const [profile] = await tx
        .select()
        .from(storageProfiles)
        .where(eq(storageProfiles.id, profileId))
        .for("update")
        .limit(1);
      if (
        profile?.source !== "managed" ||
        (profile.status !== "draft" && profile.status !== "ready")
      )
        return;
      const checks = await tx
        .select()
        .from(storageProfileChecks)
        .where(eq(storageProfileChecks.profileId, profileId));
      const ready =
        blockingStorageProfileChecks(checks).length === 0 &&
        profile.cloudflareProvisioningStatus === "verified";
      await tx
        .update(storageProfiles)
        .set({
          status: ready ? "ready" : "draft",
          readyAt: ready ? (profile.readyAt ?? new Date()) : null,
          updatedAt: new Date(),
        })
        .where(eq(storageProfiles.id, profileId));
      if (ready && profile.status !== "ready")
        await tx.insert(auditLogs).values({
          action: "storage.profile.ready",
          resourceType: "storage-profile",
          resourceId: profileId,
          result: "success",
          metadata: {},
        });
    });
  }
  async persistB2Discovery(
    profileId: string,
    fields: { bucketId: string; downloadHost: string },
  ) {
    const updated = await this.db
      .update(storageProfiles)
      .set({
        b2BucketId: fields.bucketId,
        b2DownloadHost: fields.downloadHost,
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(storageProfiles.id, profileId),
          eq(storageProfiles.source, "managed"),
        ),
      )
      .returning({ id: storageProfiles.id });
    if (!updated[0]) throw new StorageProfileStateConflictError();
  }
  async activate(profileId: string, actorId: string, requestId?: string) {
    try {
      return await this.db.transaction(async (tx) => {
        await tx.execute(
          sql`select pg_advisory_xact_lock(hashtextextended('nodeprox-storage-profile-activation', 0))`,
        );
        const [target] = await tx
          .select()
          .from(storageProfiles)
          .where(eq(storageProfiles.id, profileId))
          .for("update")
          .limit(1);
        if (!target)
          throw new StorageProfileStateConflictError(
            "storage-profile-not-found",
          );
        if (target.status === "active") return target;
        const current = await tx
          .select()
          .from(storageProfiles)
          .where(eq(storageProfiles.status, "active"))
          .for("update")
          .limit(2);
        if (current.length !== 1 || !current[0])
          throw new StorageProfileStateConflictError(
            "storage-profile-activation-conflict",
          );
        if (target.source === "env") {
          if (
            target.status !== "retired" ||
            target.id !== "00000000-0000-4000-8000-000000000001"
          )
            throw new StorageProfileStateConflictError(
              "storage-profile-activation-conflict",
            );
        } else {
          const checks = await tx
            .select()
            .from(storageProfileChecks)
            .where(eq(storageProfileChecks.profileId, profileId));
          if (
            (target.status !== "ready" && target.status !== "retired") ||
            blockingStorageProfileChecks(checks).length > 0 ||
            target.cloudflareProvisioningStatus !== "verified" ||
            !target.dnsRecordId ||
            !target.transformRuleId ||
            !target.cacheRuleId ||
            !target.b2DownloadHost
          )
            throw new StorageProfileStateConflictError(
              "storage-profile-activation-conflict",
            );
        }
        const now = new Date();
        await tx
          .update(storageProfiles)
          .set({ status: "retired", retiredAt: now, updatedAt: now })
          .where(eq(storageProfiles.id, current[0].id));
        const [activated] = await tx
          .update(storageProfiles)
          .set({
            status: "active",
            activatedAt: now,
            retiredAt: null,
            updatedAt: now,
          })
          .where(eq(storageProfiles.id, profileId))
          .returning();
        if (!activated)
          throw new StorageProfileStateConflictError(
            "storage-profile-activation-conflict",
          );
        await tx.insert(auditLogs).values({
          actorId,
          action:
            target.status === "retired"
              ? "storage.profile.reactivated"
              : "storage.profile.activated",
          resourceType: "storage-profile",
          resourceId: profileId,
          result: "success",
          ...(requestId ? { requestId } : {}),
          metadata: { previousProfileId: current[0].id },
        });
        return activated;
      });
    } catch (error) {
      if (
        typeof error === "object" &&
        error !== null &&
        "code" in error &&
        error.code === "23505"
      )
        throw new StorageProfileStateConflictError(
          "storage-profile-activation-conflict",
        );
      throw error;
    }
  }
  async createProbeSession(
    input: Parameters<
      StorageProfileReadinessRepository["createProbeSession"]
    >[0],
  ) {
    await this.db.insert(storageProfileProbeSessions).values(input);
  }
  async claimProbeSession(profileId: string, probeId: string) {
    const [row] = await this.db
      .update(storageProfileProbeSessions)
      .set({ status: "checking" })
      .where(
        and(
          eq(storageProfileProbeSessions.id, probeId),
          eq(storageProfileProbeSessions.profileId, profileId),
          eq(storageProfileProbeSessions.status, "pending"),
          sql`${storageProfileProbeSessions.expiresAt} > now()`,
        ),
      )
      .returning();
    if (row)
      return {
        state: "claimed" as const,
        storageKey: row.storageKey,
        expectedSha256: row.expectedSha256,
        expectedSizeBytes: row.expectedSizeBytes,
        contentType: row.contentType,
      };

    const [expired] = await this.db
      .update(storageProfileProbeSessions)
      .set({ status: "expired", completedAt: new Date() })
      .where(
        and(
          eq(storageProfileProbeSessions.id, probeId),
          eq(storageProfileProbeSessions.profileId, profileId),
          eq(storageProfileProbeSessions.status, "pending"),
          sql`${storageProfileProbeSessions.expiresAt} <= now()`,
        ),
      )
      .returning();
    if (expired)
      return { state: "expired" as const, storageKey: expired.storageKey };

    const [existing] = await this.db
      .select({
        status: storageProfileProbeSessions.status,
        storageKey: storageProfileProbeSessions.storageKey,
      })
      .from(storageProfileProbeSessions)
      .where(
        and(
          eq(storageProfileProbeSessions.id, probeId),
          eq(storageProfileProbeSessions.profileId, profileId),
        ),
      )
      .limit(1);
    if (!existing) return null;
    return {
      state:
        existing.status === "verified" || existing.status === "completed"
          ? ("completed" as const)
          : existing.status === "expired"
            ? ("expired" as const)
            : existing.status === "failed"
              ? ("failed" as const)
              : ("checking" as const),
      storageKey: existing.storageKey,
    };
  }
  async expireProbeSessions(profileId: string) {
    return this.db
      .update(storageProfileProbeSessions)
      .set({ status: "expired", completedAt: new Date() })
      .where(
        and(
          eq(storageProfileProbeSessions.profileId, profileId),
          eq(storageProfileProbeSessions.status, "pending"),
          sql`${storageProfileProbeSessions.expiresAt} <= now()`,
        ),
      )
      .returning({
        id: storageProfileProbeSessions.id,
        storageKey: storageProfileProbeSessions.storageKey,
      });
  }
  async completeProbeSession(
    probeId: string,
    status: "completed" | "failed" | "expired",
  ) {
    await this.db
      .update(storageProfileProbeSessions)
      .set({ status, completedAt: new Date() })
      .where(
        and(
          eq(storageProfileProbeSessions.id, probeId),
          eq(storageProfileProbeSessions.status, "checking"),
        ),
      );
  }
  async rotateCredentials(
    input: Parameters<
      StorageProfileReadinessRepository["rotateCredentials"]
    >[0],
  ) {
    return this.db.transaction(async (tx) => {
      const [profile] = await tx
        .select()
        .from(storageProfiles)
        .where(eq(storageProfiles.id, input.profileId))
        .for("update")
        .limit(1);
      if (profile?.source !== "managed")
        throw new StorageProfileStateConflictError();
      const [updated] = await tx
        .update(storageProfiles)
        .set({
          b2KeyId: input.b2KeyId,
          encryptedApplicationKey: input.encryptedApplicationKey,
          credentialVersion: profile.credentialVersion + 1,
          updatedAt: new Date(),
        })
        .where(eq(storageProfiles.id, input.profileId))
        .returning();
      if (!updated) throw new StorageProfileStateConflictError();
      await tx.insert(auditLogs).values({
        actorId: input.actorId,
        action: "storage.profile.credentials.rotated",
        resourceType: "storage-profile",
        resourceId: input.profileId,
        result: "success",
        ...(input.requestId ? { requestId: input.requestId } : {}),
        metadata: {
          fields: ["b2Credentials"],
          credentialVersion: updated.credentialVersion,
        },
      });
      return updated;
    });
  }
  async recordAudit(input: {
    profileId: string;
    action: string;
    actorId?: string;
    requestId?: string;
    result: "success" | "failed";
    reasonCode?: string;
  }) {
    await this.db.insert(auditLogs).values({
      action: input.action,
      resourceType: "storage-profile",
      resourceId: input.profileId,
      result: input.result,
      ...(input.actorId ? { actorId: input.actorId } : {}),
      ...(input.requestId ? { requestId: input.requestId } : {}),
      ...(input.reasonCode ? { reasonCode: input.reasonCode } : {}),
      metadata: {},
    });
  }
}
