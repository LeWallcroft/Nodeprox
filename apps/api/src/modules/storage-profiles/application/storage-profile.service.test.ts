import { randomBytes } from "node:crypto";
import { describe, expect, it } from "vitest";
import { AuthorizationService } from "../../authorization/application/services/authorization.service.js";
import { DefaultAuthorizationPolicy } from "../../authorization/domain/policies/authorization.policy.js";
import {
  LEGACY_STORAGE_PROFILE_ID,
  type StorageProfile,
} from "../domain/storage-profile.js";
import { AesGcmSecretCipher } from "../infrastructure/crypto/aes-gcm-secret-cipher.js";
import type { StorageProfileRepository } from "./ports/storage-profile.ports.js";
import {
  StorageProfileCipherUnavailableError,
  StorageProfileConflictError,
  StorageProfileForbiddenError,
  StorageProfileResolver,
  StorageProfileService,
} from "./storage-profile.service.js";

const context = { userId: "actor", sessionId: "session" };

function authorization(role: "admin" | "gestor") {
  return new AuthorizationService(
    new DefaultAuthorizationPolicy(),
    { findRoleByUserId: async () => role },
    { append: async () => {} },
    { getHelperCooldownDays: async () => 7 },
  );
}

function repository() {
  const profiles = new Map<string, StorageProfile>();
  const repo: StorageProfileRepository = {
    list: async () => [...profiles.values()],
    findById: async (id) => profiles.get(id) ?? null,
    createDraft: async (input) => {
      const profile: StorageProfile = {
        id: "managed-profile",
        provider: "b2",
        source: "managed",
        status: "draft",
        name: input.name,
        publicHostnameLabel: input.publicHostnameLabel,
        publicHostname: input.publicHostname,
        b2Endpoint: input.b2Endpoint,
        b2Region: input.b2Region,
        b2Bucket: input.b2Bucket,
        b2KeyId: input.b2KeyId,
        encryptedApplicationKey: input.encryptedApplicationKey,
        credentialVersion: input.encryptedApplicationKey === null ? 0 : 1,
        dnsRecordId: null,
        transformRulesetId: null,
        transformRuleId: null,
        cacheRulesetId: null,
        cloudflareProvisioningVersion: 0,
        cloudflareProvisioningStatus: "pending",
        cloudflareLastErrorCode: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      };
      profiles.set(profile.id, profile);
      return profile;
    },
    updateDraft: async (input) => {
      const previous = profiles.get(input.id);
      if (previous?.source !== "managed" || previous.status !== "draft")
        return null;
      const updated = {
        ...previous,
        ...input,
        credentialVersion:
          previous.credentialVersion +
          (input.encryptedApplicationKey === undefined ? 0 : 1),
      };
      profiles.set(input.id, updated);
      return updated;
    },
  };
  return { repo, profiles };
}

describe("StorageProfileService", () => {
  it("allows only ADMIN_STORAGE_MANAGE and never returns a managed B2 secret", async () => {
    const { repo, profiles } = repository();
    const cipher = new AesGcmSecretCipher(randomBytes(32).toString("base64"));
    const service = new StorageProfileService(
      repo,
      authorization("admin"),
      cipher,
    );
    const result = await service.create(context, {
      name: "Bucket secundario",
      publicHostnameLabel: "MANGA-CDN",
      b2ApplicationKey: "private-b2-key",
    });
    expect(result.publicHostname).toBe("manga-cdn.nodeprox.org");
    expect(JSON.stringify(result)).not.toContain("private-b2-key");
    expect(JSON.stringify(result)).not.toContain("encryptedApplicationKey");
    const stored = profiles.get("managed-profile");
    expect(stored?.credentialVersion).toBe(1);
    expect(stored?.encryptedApplicationKey).not.toBe("private-b2-key");
    expect(cipher.decrypt(stored?.encryptedApplicationKey ?? "")).toBe(
      "private-b2-key",
    );
    const rotated = await service.update(context, "managed-profile", {
      b2ApplicationKey: "new-private-key",
    });
    expect(rotated?.credentialConfigured).toBe(true);
    expect(rotated?.credentialVersion).toBe(2);
    expect(
      cipher.decrypt(
        profiles.get("managed-profile")?.encryptedApplicationKey ?? "",
      ),
    ).toBe("new-private-key");
    await expect(
      new StorageProfileService(repo, authorization("gestor"), cipher).list(
        context,
      ),
    ).rejects.toThrow(StorageProfileForbiddenError);
  });

  it("fails closed when a credential is supplied without a master key", async () => {
    const { repo } = repository();
    const service = new StorageProfileService(
      repo,
      authorization("admin"),
      null,
    );
    await expect(
      service.create(context, {
        name: "Draft",
        publicHostnameLabel: "media2",
        b2ApplicationKey: "private",
      }),
    ).rejects.toThrow(StorageProfileCipherUnavailableError);
  });

  it("versions credential writes and leaves the stored pair unchanged if encryption fails", async () => {
    const { repo, profiles } = repository();
    const cipher = new AesGcmSecretCipher(randomBytes(32).toString("base64"));
    const service = new StorageProfileService(
      repo,
      authorization("admin"),
      cipher,
    );
    const draft = await service.create(context, {
      name: "Draft",
      publicHostnameLabel: "media3",
    });
    expect(draft.credentialVersion).toBe(0);
    expect(draft.credentialConfigured).toBe(false);

    const first = await service.update(context, draft.id, {
      b2ApplicationKey: "first",
    });
    expect(first?.credentialVersion).toBe(1);
    const previous = profiles.get(draft.id);
    const failing = new StorageProfileService(repo, authorization("admin"), {
      encrypt: () => {
        throw new Error("cipher-failed");
      },
      decrypt: () => {
        throw new Error("cipher-failed");
      },
    });
    await expect(
      failing.update(context, draft.id, { b2ApplicationKey: "second" }),
    ).rejects.toThrow("cipher-failed");
    expect(profiles.get(draft.id)?.encryptedApplicationKey).toBe(
      previous?.encryptedApplicationKey,
    );
    expect(profiles.get(draft.id)?.credentialVersion).toBe(1);
  });

  it("resolves only the deterministic active legacy profile using environment storage", async () => {
    const { repo, profiles } = repository();
    const legacy: StorageProfile = {
      id: LEGACY_STORAGE_PROFILE_ID,
      provider: "b2",
      source: "env",
      status: "active",
      name: "Legacy environment",
      publicHostnameLabel: "media",
      publicHostname: "media.nodeprox.org",
      b2Endpoint: null,
      b2Region: null,
      b2Bucket: null,
      b2KeyId: null,
      encryptedApplicationKey: null,
      credentialVersion: 0,
      dnsRecordId: null,
      transformRulesetId: null,
      transformRuleId: null,
      cacheRulesetId: null,
      cloudflareProvisioningVersion: 0,
      cloudflareProvisioningStatus: "verified",
      cloudflareLastErrorCode: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    profiles.set(legacy.id, legacy);
    const storage = {
      provider: "filesystem" as const,
      uploadMaxSizeBytes: 1024,
    };
    const resolver = new StorageProfileResolver(repo, storage);
    expect(await resolver.resolveOperational(legacy.id)).toEqual({
      profile: legacy,
      storage,
    });
    await expect(resolver.resolveOperational("missing")).rejects.toThrow(
      StorageProfileConflictError,
    );
    profiles.set(legacy.id, {
      ...legacy,
      publicHostname: "other.nodeprox.org",
    });
    await expect(resolver.resolveOperational(legacy.id)).rejects.toThrow(
      StorageProfileConflictError,
    );
  });
});
