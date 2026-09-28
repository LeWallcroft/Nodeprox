export { LEGACY_STORAGE_PROFILE_ID } from "@nodeprox/storage/profile-execution";
export const LEGACY_PUBLIC_HOSTNAME = "media.nodeprox.org";
export const NODEPROX_RESERVED_HOSTNAME_LABELS = [
  "www",
  "api",
  "app",
  "admin",
] as const;

export type StorageProvider = "b2";
export type StorageProfileSource = "env" | "managed";
export type StorageProfileStatus = "draft" | "ready" | "active" | "retired";
export type CloudflareProvisioningStatus =
  | "pending"
  | "provisioning"
  | "verified"
  | "failed";

export type StorageProfile = {
  id: string;
  provider: StorageProvider;
  source: StorageProfileSource;
  status: StorageProfileStatus;
  name: string;
  publicHostnameLabel: string;
  publicHostname: string;
  b2Endpoint: string | null;
  b2Region: string | null;
  b2Bucket: string | null;
  b2KeyId: string | null;
  encryptedApplicationKey: string | null;
  credentialVersion: number;
  dnsRecordId: string | null;
  transformRulesetId: string | null;
  transformRuleId: string | null;
  cacheRulesetId: string | null;
  cloudflareProvisioningVersion: number;
  cloudflareProvisioningStatus: CloudflareProvisioningStatus;
  cloudflareLastErrorCode: string | null;
  createdAt: Date;
  updatedAt: Date;
};

export class InvalidStorageHostnameLabelError extends Error {}

export function canonicalPublicHostnameLabel(
  input: string,
  reserved: readonly string[] = [],
): string {
  const label = input.trim().toLowerCase();
  if (
    label.length < 1 ||
    label.length > 63 ||
    !/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(label) ||
    label === "media" ||
    NODEPROX_RESERVED_HOSTNAME_LABELS.some((value) => value === label) ||
    reserved.some((value) => value.toLowerCase() === label)
  )
    throw new InvalidStorageHostnameLabelError();
  return label;
}

export function managedPublicHostname(label: string): string {
  return `${label}.nodeprox.org`;
}

export function storageProfileSummaryView(profile: StorageProfile) {
  return {
    id: profile.id,
    provider: profile.provider,
    source: profile.source,
    status: profile.status,
    name: profile.name,
    publicHostnameLabel: profile.publicHostnameLabel,
    publicHostname: profile.publicHostname,
    cloudflareProvisioningStatus: profile.cloudflareProvisioningStatus,
    credentialConfigured: profile.encryptedApplicationKey !== null,
    credentialVersion: profile.credentialVersion,
    publicUrlPreview: `https://${profile.publicHostname}`,
    createdAt: profile.createdAt.toISOString(),
    updatedAt: profile.updatedAt.toISOString(),
  };
}

export function storageProfileDetailView(profile: StorageProfile) {
  return {
    ...storageProfileSummaryView(profile),
    b2Endpoint: profile.b2Endpoint,
    b2Region: profile.b2Region,
    b2Bucket: profile.b2Bucket,
    b2KeyId: profile.b2KeyId,
  };
}
