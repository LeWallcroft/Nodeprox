import { createHash, randomUUID } from "node:crypto";
import type { ManagedStorageAdministrationResolver } from "@nodeprox/storage/profile-execution";
import { StorageManagedOperationsDisabledError } from "./cloudflare-storage-profile-provisioning.service.js";
import type { StorageProfileReadinessRepository } from "./ports/storage-profile-readiness.ports.js";

const CONTENT_TYPE = "text/plain";

export class StorageProfileBrowserProbeService {
  constructor(
    private readonly repository: StorageProfileReadinessRepository,
    private readonly execution: ManagedStorageAdministrationResolver,
    private readonly enabled: boolean,
  ) {}

  async start(profileId: string) {
    if (!this.enabled) throw new StorageManagedOperationsDisabledError();
    const profile = await this.repository.findById(profileId);
    if (profile?.source !== "managed")
      throw new Error("B2_BROWSER_UPLOAD_PROBE_FAILED");
    await this.expireAbandonedSessions(profileId);
    const checks = await this.repository.listChecks(profileId);
    if (
      !["b2_credentials", "b2_bucket", "b2_cors"].every((type) =>
        checks.some(
          (check) => check.checkType === type && check.status === "verified",
        ),
      )
    )
      throw new Error("B2_BROWSER_UPLOAD_PROBE_FAILED");
    const probeId = randomUUID();
    const body = Buffer.from(`nodeprox-browser-probe:${probeId}`);
    const storageKey = `uploads/nodeprox-browser-probe/${profileId}/${probeId}.txt`;
    const expiresAt = new Date(Date.now() + 300_000);
    await this.repository.createProbeSession({
      id: probeId,
      profileId,
      storageKey,
      expectedSha256: createHash("sha256").update(body).digest("hex"),
      expectedSizeBytes: body.length,
      contentType: CONTENT_TYPE,
      expiresAt,
    });
    const transfer =
      await this.execution.administrationUploadTransferFor(profileId);
    const grant = await transfer.initiate({
      key: storageKey,
      contentType: CONTENT_TYPE,
      sizeBytes: body.length,
      expiresInSeconds: 300,
    });
    if (grant.mode !== "single")
      throw new Error("B2_BROWSER_UPLOAD_PROBE_FAILED");
    await this.repository.upsertCheck({
      profileId,
      type: "b2_browser_upload",
      status: "checking",
    });
    return {
      probeId,
      grant,
      body: body.toString("utf8"),
      contentType: CONTENT_TYPE,
      expiresAt: expiresAt.toISOString(),
    };
  }

  async complete(
    profileId: string,
    probeId: string,
    outcome: "uploaded" | "client_failed",
    actorId?: string,
    requestId?: string,
  ): Promise<"verified" | "failed"> {
    if (!this.enabled) throw new StorageManagedOperationsDisabledError();
    const session = await this.repository.claimProbeSession(profileId, probeId);
    if (!session) throw new Error("B2_BROWSER_UPLOAD_PROBE_FAILED");
    if (session.state === "completed") return "verified";
    if (session.state === "failed") return "failed";
    if (session.state === "checking") return "failed";
    if (session.state === "expired") {
      const storage = await this.execution
        .administrationStorageFor(profileId)
        .catch(() => null);
      if (storage)
        await storage.delete(session.storageKey).catch(() => undefined);
      await this.recordFailedProbe(
        profileId,
        probeId,
        "B2_BROWSER_UPLOAD_PROBE_EXPIRED",
        undefined,
        undefined,
        "expired",
      );
      return "failed";
    }

    if (outcome === "client_failed") {
      const storage = await this.execution
        .administrationStorageFor(profileId)
        .catch(() => null);
      if (storage)
        await storage.delete(session.storageKey).catch(() => undefined);
      await this.recordFailedProbe(
        profileId,
        probeId,
        "B2_BROWSER_UPLOAD_PROBE_FAILED",
        actorId,
        requestId,
      );
      return "failed";
    }

    let storage: Awaited<
      ReturnType<
        ManagedStorageAdministrationResolver["administrationStorageFor"]
      >
    > | null = null;
    try {
      storage = await this.execution.administrationStorageFor(profileId);
      const head = await storage.head?.(session.storageKey);
      if (head && head.sizeBytes !== session.expectedSizeBytes)
        throw new Error();
      const chunks: Buffer[] = [];
      for await (const chunk of await storage.get(session.storageKey))
        chunks.push(Buffer.from(chunk));
      const bytes = Buffer.concat(chunks);
      if (
        bytes.length !== session.expectedSizeBytes ||
        createHash("sha256").update(bytes).digest("hex") !==
          session.expectedSha256
      )
        throw new Error();
      await storage.delete(session.storageKey);
      await this.repository.completeProbeSession(probeId, "completed");
      await this.repository.upsertCheck({
        profileId,
        type: "b2_browser_upload",
        status: "verified",
        metadata: { probeTimestamp: new Date().toISOString() },
      });
      await this.repository.recomputeReadiness(profileId);
      await this.repository.recordAudit?.({
        profileId,
        action: "storage.profile.browser_probe.completed",
        result: "success",
        ...(actorId ? { actorId } : {}),
        ...(requestId ? { requestId } : {}),
      });
      return "verified";
    } catch {
      if (!storage)
        storage = await this.execution
          .administrationStorageFor(profileId)
          .catch(() => null);
      if (storage)
        await storage.delete(session.storageKey).catch(() => undefined);
      await this.recordFailedProbe(
        profileId,
        probeId,
        "B2_BROWSER_UPLOAD_PROBE_FAILED",
        actorId,
        requestId,
      );
      throw new Error("B2_BROWSER_UPLOAD_PROBE_FAILED");
    }
  }

  private async expireAbandonedSessions(profileId: string): Promise<void> {
    const expired = await this.repository.expireProbeSessions(profileId);
    if (expired.length === 0) return;
    const storage = await this.execution
      .administrationStorageFor(profileId)
      .catch(() => null);
    if (storage)
      await Promise.all(
        expired.map((session) =>
          storage.delete(session.storageKey).catch(() => undefined),
        ),
      );
    await this.repository.upsertCheck({
      profileId,
      type: "b2_browser_upload",
      status: "failed",
      errorCode: "B2_BROWSER_UPLOAD_PROBE_EXPIRED",
    });
    await this.repository.recomputeReadiness(profileId);
  }

  private async recordFailedProbe(
    profileId: string,
    probeId: string,
    errorCode:
      | "B2_BROWSER_UPLOAD_PROBE_FAILED"
      | "B2_BROWSER_UPLOAD_PROBE_EXPIRED",
    actorId?: string,
    requestId?: string,
    sessionStatus: "failed" | "expired" = "failed",
  ): Promise<void> {
    await this.repository.completeProbeSession(probeId, sessionStatus);
    await this.repository.upsertCheck({
      profileId,
      type: "b2_browser_upload",
      status: "failed",
      errorCode,
    });
    await this.repository.recomputeReadiness(profileId);
    await this.repository.recordAudit?.({
      profileId,
      action: "storage.profile.browser_probe.completed",
      result: "failed",
      reasonCode: errorCode,
      ...(actorId ? { actorId } : {}),
      ...(requestId ? { requestId } : {}),
    });
  }
}
