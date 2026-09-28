import type { NodeProxStorageProfileConfig } from "@nodeprox/config";
import {
  AesGcmSecretCipher,
  type ManagedStorageAdministrationResolver,
} from "@nodeprox/storage/profile-execution";
import type { NodeProxDatabase } from "../../../../database/client.js";
import { B2StorageProfileProvisioningService } from "../modules/storage-profiles/application/b2-storage-profile-provisioning.service.js";
import { CloudflareStorageProfileProvisioningService } from "../modules/storage-profiles/application/cloudflare-storage-profile-provisioning.service.js";
import { StorageProfileActivationService } from "../modules/storage-profiles/application/storage-profile-activation.service.js";
import { StorageProfileBrowserProbeService } from "../modules/storage-profiles/application/storage-profile-browser-probe.service.js";
import { StorageProfileCredentialRotationService } from "../modules/storage-profiles/application/storage-profile-credential-rotation.service.js";
import { StorageProfileReadinessService } from "../modules/storage-profiles/application/storage-profile-readiness.service.js";
import type { B2BucketAdministrationPort } from "../modules/storage-profiles/application/ports/b2-administration.ports.js";
import type {
  CloudflareDeliveryProbePort,
  CloudflareDnsPort,
  CloudflareRulesPort,
} from "../modules/storage-profiles/application/ports/cloudflare.ports.js";
import { B2BucketAdministrationAdapter } from "../modules/storage-profiles/infrastructure/b2/b2-bucket-administration.adapter.js";
import {
  CloudflareClient,
  CloudflareDeliveryProbeAdapter,
  CloudflareDnsAdapter,
  CloudflareRulesAdapter,
} from "../modules/storage-profiles/infrastructure/cloudflare/cloudflare-adapters.js";
import { DrizzleStorageProfileReadinessRepository } from "../modules/storage-profiles/infrastructure/persistence/drizzle/storage-profile-readiness.repository.js";

export type StorageProfileProviderOverrides = {
  b2?: B2BucketAdministrationPort;
  dns?: CloudflareDnsPort;
  transform?: CloudflareRulesPort;
  cache?: CloudflareRulesPort;
  delivery?: CloudflareDeliveryProbePort;
};

export function createStorageProfileControl(input: {
  database: NodeProxDatabase;
  config: NodeProxStorageProfileConfig;
  administration: ManagedStorageAdministrationResolver;
  providers?: StorageProfileProviderOverrides;
}) {
  const { database, config, administration } = input;
  const repository = new DrizzleStorageProfileReadinessRepository(database);
  const enabled = config.STORAGE_MANAGED_PROFILE_OPERATIONS_ENABLED;
  const cipher = config.STORAGE_PROFILE_MASTER_KEY
    ? new AesGcmSecretCipher(config.STORAGE_PROFILE_MASTER_KEY)
    : null;
  const b2 = input.providers?.b2 ?? new B2BucketAdministrationAdapter();
  const zone = config.CLOUDFLARE_ZONE_ID;
  const provisioningToken = config.CLOUDFLARE_PROVISIONING_API_TOKEN;
  const cacheToken = config.CLOUDFLARE_CACHE_RULES_API_TOKEN;
  const dns =
    input.providers?.dns ??
    (zone && provisioningToken
      ? new CloudflareDnsAdapter(new CloudflareClient(zone, provisioningToken))
      : null);
  const transform =
    input.providers?.transform ??
    (zone && provisioningToken
      ? new CloudflareRulesAdapter(
          new CloudflareClient(zone, provisioningToken),
        )
      : null);
  const cache =
    input.providers?.cache ??
    (zone && cacheToken
      ? new CloudflareRulesAdapter(new CloudflareClient(zone, cacheToken))
      : null);
  const delivery =
    input.providers?.delivery ?? new CloudflareDeliveryProbeAdapter();
  const origins = config.STORAGE_BROWSER_UPLOAD_ORIGINS.split(",")
    .map((value) => value.trim())
    .filter(Boolean);
  return {
    repository,
    readiness: new StorageProfileReadinessService(repository, enabled),
    activation: new StorageProfileActivationService(repository, enabled),
    b2: new B2StorageProfileProvisioningService(
      repository,
      b2,
      administration,
      cipher,
      origins,
      enabled,
    ),
    browserProbe: new StorageProfileBrowserProbeService(
      repository,
      administration,
      enabled,
    ),
    credentialRotation: new StorageProfileCredentialRotationService(
      repository,
      b2,
      cipher,
    ),
    cloudflare:
      dns && transform && cache
        ? new CloudflareStorageProfileProvisioningService(
            repository,
            dns,
            transform,
            cache,
            delivery,
            administration,
            enabled,
          )
        : null,
  };
}

export type StorageProfileControl = ReturnType<
  typeof createStorageProfileControl
>;
