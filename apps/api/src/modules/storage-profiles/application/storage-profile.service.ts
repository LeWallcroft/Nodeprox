import type { NodeProxStorageConfig } from "@nodeprox/config";
import type { AuthorizationService } from "../../authorization/application/services/authorization.service.js";
import type { AuthorizationContext } from "../../authorization/domain/authorization.types.js";
import { PERMISSIONS } from "../../authorization/domain/permissions.js";
import {
  canonicalPublicHostnameLabel,
  LEGACY_PUBLIC_HOSTNAME,
  LEGACY_STORAGE_PROFILE_ID,
  managedPublicHostname,
  type StorageProfile,
  storageProfileDetailView,
  storageProfileSummaryView,
} from "../domain/storage-profile.js";
import type {
  SecretCipherPort,
  StorageProfileRepository,
} from "./ports/storage-profile.ports.js";

export class StorageProfileForbiddenError extends Error {}
export class StorageProfileConflictError extends Error {}
export class StorageProfileCipherUnavailableError extends Error {}

export type StorageProfileDraftInput = {
  name: string;
  publicHostnameLabel: string;
  b2Endpoint?: string | null | undefined;
  b2Region?: string | null | undefined;
  b2Bucket?: string | null | undefined;
  b2KeyId?: string | null | undefined;
  b2ApplicationKey?: string | undefined;
};
export type StorageProfileDraftPatchInput = Omit<
  Partial<StorageProfileDraftInput>,
  "name" | "publicHostnameLabel"
> & {
  name?: string | undefined;
  publicHostnameLabel?: string | undefined;
};

export class StorageProfileService {
  constructor(
    private readonly repository: StorageProfileRepository,
    private readonly authorization: AuthorizationService,
    private readonly cipher: SecretCipherPort | null,
    private readonly reservedLabels: readonly string[] = [],
  ) {}

  private async requireManage(context: AuthorizationContext) {
    const decision = await this.authorization.authorize(
      context,
      PERMISSIONS.ADMIN_STORAGE_MANAGE,
    );
    if (!decision.allowed) throw new StorageProfileForbiddenError();
  }

  async list(context: AuthorizationContext) {
    await this.requireManage(context);
    return {
      items: (await this.repository.list()).map(storageProfileSummaryView),
    };
  }

  async find(context: AuthorizationContext, id: string) {
    await this.requireManage(context);
    const profile = await this.repository.findById(id);
    return profile ? storageProfileDetailView(profile) : null;
  }

  async create(
    context: AuthorizationContext,
    input: StorageProfileDraftInput,
    requestId?: string,
  ) {
    await this.requireManage(context);
    const label = canonicalPublicHostnameLabel(
      input.publicHostnameLabel,
      this.reservedLabels,
    );
    const encryptedApplicationKey = this.encryptIfSupplied(
      input.b2ApplicationKey,
    );
    const profile = await this.repository.createDraft({
      name: input.name.trim(),
      publicHostnameLabel: label,
      publicHostname: managedPublicHostname(label),
      b2Endpoint: input.b2Endpoint ?? null,
      b2Region: input.b2Region ?? null,
      b2Bucket: input.b2Bucket ?? null,
      b2KeyId: input.b2KeyId ?? null,
      encryptedApplicationKey,
      actorId: context.userId,
      ...(requestId ? { requestId } : {}),
    });
    return storageProfileDetailView(profile);
  }

  async update(
    context: AuthorizationContext,
    id: string,
    input: StorageProfileDraftPatchInput,
    requestId?: string,
  ) {
    await this.requireManage(context);
    const label = input.publicHostnameLabel
      ? canonicalPublicHostnameLabel(
          input.publicHostnameLabel,
          this.reservedLabels,
        )
      : undefined;
    const encryptedApplicationKey = this.encryptIfSupplied(
      input.b2ApplicationKey,
    );
    const profile = await this.repository.updateDraft({
      id,
      ...(input.name !== undefined ? { name: input.name.trim() } : {}),
      ...(label
        ? {
            publicHostnameLabel: label,
            publicHostname: managedPublicHostname(label),
          }
        : {}),
      ...(input.b2Endpoint !== undefined
        ? { b2Endpoint: input.b2Endpoint }
        : {}),
      ...(input.b2Region !== undefined ? { b2Region: input.b2Region } : {}),
      ...(input.b2Bucket !== undefined ? { b2Bucket: input.b2Bucket } : {}),
      ...(input.b2KeyId !== undefined ? { b2KeyId: input.b2KeyId } : {}),
      ...(encryptedApplicationKey !== null ? { encryptedApplicationKey } : {}),
      actorId: context.userId,
      ...(requestId ? { requestId } : {}),
    });
    return profile ? storageProfileDetailView(profile) : null;
  }

  private encryptIfSupplied(value: string | undefined): string | null {
    if (value === undefined) return null;
    if (!this.cipher) throw new StorageProfileCipherUnavailableError();
    return this.cipher.encrypt(value);
  }
}

/** Foundation resolver: managed drafts are intentionally not operational. */
export class StorageProfileResolver {
  constructor(
    private readonly repository: StorageProfileRepository,
    private readonly legacyEnvironment: NodeProxStorageConfig,
  ) {}

  async resolveOperational(profileId: string): Promise<{
    profile: StorageProfile;
    storage: NodeProxStorageConfig;
  }> {
    const profile = await this.repository.findById(profileId);
    if (
      profile?.id !== LEGACY_STORAGE_PROFILE_ID ||
      profile.provider !== "b2" ||
      profile.source !== "env" ||
      profile.status !== "active" ||
      profile.publicHostnameLabel !== "media" ||
      profile.publicHostname !== LEGACY_PUBLIC_HOSTNAME ||
      profile.credentialVersion !== 0 ||
      profile.encryptedApplicationKey !== null ||
      profile.b2Endpoint !== null ||
      profile.b2Region !== null ||
      profile.b2Bucket !== null ||
      profile.b2KeyId !== null
    )
      throw new StorageProfileConflictError();
    return { profile, storage: this.legacyEnvironment };
  }
}
