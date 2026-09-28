export type B2ManagedCredentials = {
  endpoint: string;
  region: string;
  bucket: string;
  keyId: string;
  applicationKey: string;
};
export type B2CorsRule = {
  corsRuleName: string;
  allowedOrigins: string[];
  allowedOperations: string[];
  allowedHeaders: string[];
  exposeHeaders: string[];
  maxAgeSeconds: number;
};
export type B2LifecycleRule = {
  id: string;
  prefix: string;
  expirationDays: number | null;
  noncurrentDays: number | null;
  abortMultipartDays: number | null;
};
export type B2BucketInspection = {
  bucketId: string;
  downloadHost: string;
  public: boolean;
  revision: number;
  corsRules: B2CorsRule[];
  lifecycleRules: B2LifecycleRule[];
};
export type B2ConfigurationResult = {
  status: "verified" | "manual_required";
  metadata: Record<string, string | number | boolean | null>;
};

export interface B2BucketAdministrationPort {
  inspect(credentials: B2ManagedCredentials): Promise<B2BucketInspection>;
  ensureNodeProxCors(input: {
    credentials: B2ManagedCredentials;
    inspection: B2BucketInspection;
    allowedOrigins: readonly string[];
    recheckOnly: boolean;
  }): Promise<B2ConfigurationResult>;
  ensureNodeProxLifecycle(input: {
    credentials: B2ManagedCredentials;
    inspection: B2BucketInspection;
    recheckOnly: boolean;
  }): Promise<B2ConfigurationResult>;
  validateCredentials(credentials: B2ManagedCredentials): Promise<void>;
}
