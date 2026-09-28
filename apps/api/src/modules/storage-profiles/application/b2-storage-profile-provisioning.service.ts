import { randomUUID } from "node:crypto";
import { Readable } from "node:stream";
import type {
  ManagedStorageAdministrationResolver,
  SecretCipherPort,
} from "@nodeprox/storage/profile-execution";
import type {
  B2BucketAdministrationPort,
  B2ManagedCredentials,
} from "./ports/b2-administration.ports.js";
import type { StorageProfileReadinessRepository } from "./ports/storage-profile-readiness.ports.js";
import { StorageManagedOperationsDisabledError } from "./cloudflare-storage-profile-provisioning.service.js";
import { B2AdministrationError } from "../infrastructure/b2/b2-bucket-administration.adapter.js";

export class B2StorageProfileProvisioningService {
  constructor(
    private readonly repository: StorageProfileReadinessRepository,
    private readonly administration: B2BucketAdministrationPort,
    private readonly storageExecution: ManagedStorageAdministrationResolver,
    private readonly cipher: SecretCipherPort | null,
    private readonly allowedOrigins: readonly string[],
    private readonly enabled: boolean,
  ) {}

  async credentialsFor(profileId: string): Promise<B2ManagedCredentials> {
    const profile = await this.repository.findById(profileId);
    if (
      profile?.source !== "managed" ||
      !profile.b2Endpoint ||
      !profile.b2Region ||
      !profile.b2Bucket ||
      !profile.b2KeyId ||
      !profile.encryptedApplicationKey
    )
      throw new B2AdministrationError("B2_AUTHORIZATION_ERROR");
    if (!this.cipher)
      throw new B2AdministrationError("storage-profile-cipher-unavailable");
    let applicationKey: string;
    try {
      applicationKey = this.cipher.decrypt(profile.encryptedApplicationKey);
    } catch {
      throw new B2AdministrationError("storage-profile-runtime-secret-invalid");
    }
    return {
      endpoint: profile.b2Endpoint,
      region: profile.b2Region,
      bucket: profile.b2Bucket,
      keyId: profile.b2KeyId,
      applicationKey,
    };
  }

  async provision(
    profileId: string,
    recheckOnly = false,
    actorId?: string,
    requestId?: string,
  ): Promise<void> {
    if (!this.enabled) throw new StorageManagedOperationsDisabledError();
    await this.repository.recordAudit?.({
      profileId,
      action: "storage.profile.b2.provision.started",
      result: "success",
      ...(actorId ? { actorId } : {}),
      ...(requestId ? { requestId } : {}),
    });
    try {
      await this.provisionInternal(profileId, recheckOnly);
      await this.repository.recordAudit?.({
        profileId,
        action: "storage.profile.b2.provision.completed",
        result: "success",
        ...(actorId ? { actorId } : {}),
        ...(requestId ? { requestId } : {}),
      });
    } catch (error) {
      await this.repository.recordAudit?.({
        profileId,
        action: "storage.profile.b2.provision.failed",
        result: "failed",
        reasonCode:
          error instanceof B2AdministrationError
            ? error.code
            : "B2_PROVIDER_ERROR",
        ...(actorId ? { actorId } : {}),
        ...(requestId ? { requestId } : {}),
      });
      throw error;
    }
  }

  private async provisionInternal(
    profileId: string,
    recheckOnly: boolean,
  ): Promise<void> {
    const credentials = await this.credentialsFor(profileId);
    await this.repository.upsertCheck({
      profileId,
      type: "b2_credentials",
      status: "checking",
    });
    let inspection: Awaited<ReturnType<B2BucketAdministrationPort["inspect"]>>;
    try {
      inspection = await this.administration.inspect(credentials);
      await this.repository.upsertCheck({
        profileId,
        type: "b2_credentials",
        status: "verified",
      });
      if (!inspection.public)
        throw new B2AdministrationError("B2_BUCKET_NOT_PUBLIC");
      await this.repository.persistB2Discovery(profileId, {
        bucketId: inspection.bucketId,
        downloadHost: inspection.downloadHost,
      });
      await this.repository.upsertCheck({
        profileId,
        type: "b2_bucket",
        status: "verified",
        metadata: { bucketPublic: true },
      });
    } catch (error) {
      await this.repository.upsertCheck({
        profileId,
        type: "b2_bucket",
        status: "failed",
        errorCode:
          error instanceof B2AdministrationError
            ? error.code
            : "B2_PROVIDER_ERROR",
      });
      await this.repository.recomputeReadiness(profileId);
      throw error;
    }
    try {
      const cors = await this.administration.ensureNodeProxCors({
        credentials,
        inspection,
        allowedOrigins: this.allowedOrigins,
        recheckOnly,
      });
      await this.repository.upsertCheck({
        profileId,
        type: "b2_cors",
        status: cors.status,
        metadata: cors.metadata,
        errorCode:
          cors.status === "manual_required" ? "B2_CORS_MANUAL_REQUIRED" : null,
      });
      const lifecycle = await this.administration.ensureNodeProxLifecycle({
        credentials,
        inspection,
        recheckOnly,
      });
      await this.repository.upsertCheck({
        profileId,
        type: "b2_lifecycle",
        status: lifecycle.status,
        metadata: lifecycle.metadata,
        errorCode:
          lifecycle.status === "manual_required"
            ? "B2_LIFECYCLE_MANUAL_REQUIRED"
            : null,
      });
      await this.probe(profileId);
      await this.repository.upsertCheck({
        profileId,
        type: "b2_storage_probe",
        status: "verified",
        metadata: { probeTimestamp: new Date().toISOString() },
      });
    } catch (error) {
      const code =
        error instanceof B2AdministrationError
          ? error.code
          : "B2_PROVIDER_ERROR";
      if (
        code === "B2_MEDIA_LIFECYCLE_CONFLICT" ||
        code.startsWith("B2_LIFECYCLE")
      )
        await this.repository.upsertCheck({
          profileId,
          type: "b2_lifecycle",
          status: "failed",
          errorCode: code,
        });
      else if (code.startsWith("B2_CORS"))
        await this.repository.upsertCheck({
          profileId,
          type: "b2_cors",
          status: "failed",
          errorCode: code,
        });
      else
        await this.repository.upsertCheck({
          profileId,
          type: "b2_storage_probe",
          status: "failed",
          errorCode: code,
        });
      await this.repository.recomputeReadiness(profileId);
      throw error;
    }
    await this.repository.recomputeReadiness(profileId);
  }

  private async probe(profileId: string) {
    const storage =
      await this.storageExecution.administrationStorageFor(profileId);
    const key = `uploads/nodeprox-probe/${profileId}/${randomUUID()}.bin`;
    const body = Buffer.from("nodeprox-b2-storage-probe-v1");
    try {
      await storage.put({
        key,
        body: Readable.from(body),
        contentType: "application/octet-stream",
        sizeBytes: body.length,
      });
      const head = await storage.head?.(key);
      if (head && head.sizeBytes !== body.length)
        throw new B2AdministrationError("B2_STORAGE_PROBE_FAILED");
      const stream = await storage.get(key);
      const chunks: Buffer[] = [];
      for await (const chunk of stream) chunks.push(Buffer.from(chunk));
      if (!Buffer.concat(chunks).equals(body))
        throw new B2AdministrationError("B2_STORAGE_PROBE_FAILED");
    } catch {
      throw new B2AdministrationError("B2_STORAGE_PROBE_FAILED");
    } finally {
      await storage.delete(key);
    }
  }
}
