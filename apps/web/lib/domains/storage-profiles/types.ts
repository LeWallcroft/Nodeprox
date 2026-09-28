export type StorageProfileSummary = {
  id: string;
  provider: "b2";
  source: "env" | "managed";
  status: "draft" | "ready" | "active" | "retired";
  name: string;
  publicHostnameLabel: string;
  publicHostname: string;
  publicUrlPreview: string;
  credentialConfigured: boolean;
  credentialVersion: number;
  cloudflareProvisioningStatus:
    | "pending"
    | "provisioning"
    | "verified"
    | "failed";
  createdAt: string;
  updatedAt: string;
};

export type StorageProfileDetail = StorageProfileSummary & {
  b2Endpoint: string | null;
  b2Region: string | null;
  b2Bucket: string | null;
  b2KeyId: string | null;
};

export type StorageReadinessCheck = {
  type: string;
  status: "pending" | "checking" | "verified" | "manual_required" | "failed";
  lastErrorCode: string | null;
  metadata: Record<string, unknown>;
  checkedAt: string | null;
  verifiedAt: string | null;
};

export type StorageProfileReadiness = {
  profileId: string;
  overallStatus: StorageProfileSummary["status"];
  operationalMutationsEnabled: boolean;
  b2: {
    bucketIdConfigured: boolean;
    downloadHostConfigured: boolean;
    checks: StorageReadinessCheck[];
  };
  cloudflare: {
    provisioningStatus: StorageProfileSummary["cloudflareProvisioningStatus"];
    checks: StorageReadinessCheck[];
    lastErrorCode: string | null;
  };
  activation: { eligible: boolean; blockingChecks: string[] };
};

export type StorageProfileDraftInput = {
  name: string;
  publicHostnameLabel: string;
  b2Endpoint: string | null;
  b2Region: string | null;
  b2Bucket: string | null;
  b2KeyId: string | null;
  b2ApplicationKey?: string;
};
