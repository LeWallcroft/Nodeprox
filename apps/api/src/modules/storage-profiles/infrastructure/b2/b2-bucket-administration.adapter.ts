import {
  GetBucketLifecycleConfigurationCommand,
  PutBucketLifecycleConfigurationCommand,
  S3Client,
  type LifecycleRule,
} from "@aws-sdk/client-s3";
import type {
  B2BucketAdministrationPort,
  B2BucketInspection,
  B2ConfigurationResult,
  B2CorsRule,
  B2LifecycleRule,
  B2ManagedCredentials,
} from "../../application/ports/b2-administration.ports.js";
import {
  desiredNodeProxCors,
  desiredNodeProxLifecycle,
  equivalentCors,
  equivalentLifecycle,
  harmfulMediaLifecycle,
  NODEPROX_CORS_RULE_NAME,
  NODEPROX_LIFECYCLE_RULE_ID,
} from "../../domain/b2-readiness-policy.js";

const NODEPROX_LIFECYCLE_MARKER_RULE_ID = `${NODEPROX_LIFECYCLE_RULE_ID}_marker`;

type Fetcher = typeof fetch;
type NativeAuthorization = {
  accountId: string;
  authorizationToken: string;
  apiInfo: { storageApi: { apiUrl: string; downloadUrl: string } };
};
type NativeBucket = {
  bucketId: string;
  bucketName: string;
  bucketType: string;
  revision: number;
  corsRules: B2CorsRule[];
};
type NativeEnvelope = { buckets: NativeBucket[] };
type S3Sender = {
  send(
    command:
      | GetBucketLifecycleConfigurationCommand
      | PutBucketLifecycleConfigurationCommand,
  ): Promise<unknown>;
};

function lifecyclePrefix(rule: LifecycleRule): string {
  return rule.Filter && "Prefix" in rule.Filter
    ? (rule.Filter.Prefix ?? "")
    : (rule.Prefix ?? "");
}

function semanticLifecycle(rule: LifecycleRule): B2LifecycleRule {
  return {
    id: rule.ID ?? "",
    prefix: lifecyclePrefix(rule),
    expirationDays: rule.Expiration?.Days ?? null,
    noncurrentDays: rule.NoncurrentVersionExpiration?.NoncurrentDays ?? null,
    abortMultipartDays:
      rule.AbortIncompleteMultipartUpload?.DaysAfterInitiation ?? null,
  };
}

function normalizeLifecycleRules(rules: readonly LifecycleRule[]): {
  foreign: B2LifecycleRule[];
  nodeProx: B2LifecycleRule | null;
  markerValid: boolean;
} {
  const base = rules.find((rule) => rule.ID === NODEPROX_LIFECYCLE_RULE_ID);
  const marker = rules.find(
    (rule) => rule.ID === NODEPROX_LIFECYCLE_MARKER_RULE_ID,
  );
  const foreign = rules
    .filter(
      (rule) =>
        rule.ID !== NODEPROX_LIFECYCLE_RULE_ID &&
        rule.ID !== NODEPROX_LIFECYCLE_MARKER_RULE_ID &&
        rule.Status === "Enabled",
    )
    .map(semanticLifecycle);

  return {
    foreign,
    nodeProx: base?.Status === "Enabled" ? semanticLifecycle(base) : null,
    markerValid:
      marker?.Status === "Enabled" &&
      marker.Expiration?.ExpiredObjectDeleteMarker === true &&
      lifecyclePrefix(marker) === desiredNodeProxLifecycle().prefix,
  };
}

function nodeProxLifecycleRules(desired: B2LifecycleRule): LifecycleRule[] {
  return [
    {
      ID: desired.id,
      Status: "Enabled",
      Filter: { Prefix: desired.prefix },
      Expiration: { Days: desired.expirationDays ?? undefined },
      NoncurrentVersionExpiration: {
        NoncurrentDays: desired.noncurrentDays ?? undefined,
      },
      AbortIncompleteMultipartUpload: {
        DaysAfterInitiation: desired.abortMultipartDays ?? undefined,
      },
    },
    {
      ID: NODEPROX_LIFECYCLE_MARKER_RULE_ID,
      Status: "Enabled",
      Filter: { Prefix: desired.prefix },
      Expiration: { ExpiredObjectDeleteMarker: true },
    },
  ];
}

export class B2AdministrationError extends Error {
  constructor(readonly code: string) {
    super(code);
  }
}

function isCapabilityError(error: unknown): boolean {
  if (typeof error !== "object" || error === null) return false;
  return (
    ("status" in error && (error.status === 401 || error.status === 403)) ||
    ("$metadata" in error &&
      typeof error.$metadata === "object" &&
      error.$metadata !== null &&
      "httpStatusCode" in error.$metadata &&
      (error.$metadata.httpStatusCode === 401 ||
        error.$metadata.httpStatusCode === 403))
  );
}

export class B2BucketAdministrationAdapter
  implements B2BucketAdministrationPort
{
  constructor(
    private readonly fetcher: Fetcher = fetch,
    private readonly s3Factory: (
      credentials: B2ManagedCredentials,
    ) => S3Sender = (credentials) =>
      new S3Client({
        endpoint: credentials.endpoint,
        region: credentials.region,
        forcePathStyle: true,
        credentials: {
          accessKeyId: credentials.keyId,
          secretAccessKey: credentials.applicationKey,
        },
      }),
  ) {}

  private async authorize(
    credentials: B2ManagedCredentials,
  ): Promise<NativeAuthorization> {
    let response: Response;
    try {
      response = await this.fetcher(
        "https://api.backblazeb2.com/b2api/v4/b2_authorize_account",
        {
          headers: {
            authorization: `Basic ${Buffer.from(`${credentials.keyId}:${credentials.applicationKey}`).toString("base64")}`,
          },
          signal: AbortSignal.timeout(10_000),
        },
      );
    } catch {
      throw new B2AdministrationError("B2_PROVIDER_ERROR");
    }
    if (response.status === 401 || response.status === 403)
      throw new B2AdministrationError("B2_AUTHORIZATION_ERROR");
    if (!response.ok) throw new B2AdministrationError("B2_PROVIDER_ERROR");
    try {
      const result = (await response.json()) as NativeAuthorization;
      if (
        !result.accountId ||
        !result.authorizationToken ||
        !result.apiInfo?.storageApi?.apiUrl ||
        !result.apiInfo.storageApi.downloadUrl
      )
        throw new Error();
      return result;
    } catch {
      throw new B2AdministrationError("B2_PROVIDER_ERROR");
    }
  }

  private async native<T>(
    auth: NativeAuthorization,
    operation: string,
    body: unknown,
  ): Promise<T> {
    let response: Response;
    try {
      response = await this.fetcher(
        `${auth.apiInfo.storageApi.apiUrl}/b2api/v4/${operation}`,
        {
          method: "POST",
          headers: {
            authorization: auth.authorizationToken,
            "content-type": "application/json",
          },
          body: JSON.stringify(body),
          signal: AbortSignal.timeout(10_000),
        },
      );
    } catch {
      throw new B2AdministrationError("B2_PROVIDER_ERROR");
    }
    if (response.status === 401 || response.status === 403)
      throw new B2AdministrationError("B2_CAPABILITY_REQUIRED");
    if (!response.ok) throw new B2AdministrationError("B2_PROVIDER_ERROR");
    try {
      return (await response.json()) as T;
    } catch {
      throw new B2AdministrationError("B2_PROVIDER_ERROR");
    }
  }

  async validateCredentials(credentials: B2ManagedCredentials): Promise<void> {
    await this.inspect(credentials);
  }

  async inspect(
    credentials: B2ManagedCredentials,
  ): Promise<B2BucketInspection> {
    const auth = await this.authorize(credentials);
    const listed = await this.native<NativeEnvelope>(auth, "b2_list_buckets", {
      accountId: auth.accountId,
      bucketName: credentials.bucket,
    });
    const bucket = listed.buckets.find(
      (item) => item.bucketName === credentials.bucket,
    );
    if (!bucket) throw new B2AdministrationError("B2_BUCKET_NOT_FOUND");
    const download = new URL(auth.apiInfo.storageApi.downloadUrl);
    if (
      download.protocol !== "https:" ||
      download.pathname !== "/" ||
      download.search ||
      download.hash
    )
      throw new B2AdministrationError("B2_PROVIDER_ERROR");
    return {
      bucketId: bucket.bucketId,
      downloadHost: download.hostname,
      public: bucket.bucketType === "allPublic",
      revision: bucket.revision,
      corsRules: bucket.corsRules ?? [],
      lifecycleRules: [],
    };
  }

  async ensureNodeProxCors(input: {
    credentials: B2ManagedCredentials;
    inspection: B2BucketInspection;
    allowedOrigins: readonly string[];
    recheckOnly: boolean;
  }): Promise<B2ConfigurationResult> {
    const desired = desiredNodeProxCors(input.allowedOrigins);
    const metadata = {
      desiredCorsRuleName: NODEPROX_CORS_RULE_NAME,
      allowedOriginCount: desired.allowedOrigins.length,
      desiredCorsConfiguration: JSON.stringify(desired),
    };
    const current = input.inspection.corsRules.find(
      (rule) => rule.corsRuleName === NODEPROX_CORS_RULE_NAME,
    );
    if (current && equivalentCors(current, desired))
      return { status: "verified", metadata };
    if (input.recheckOnly) return { status: "manual_required", metadata };
    const auth = await this.authorize(input.credentials);
    try {
      await this.native(auth, "b2_update_bucket", {
        accountId: auth.accountId,
        bucketId: input.inspection.bucketId,
        ifRevisionIs: input.inspection.revision,
        corsRules: [
          ...input.inspection.corsRules.filter(
            (rule) => rule.corsRuleName !== NODEPROX_CORS_RULE_NAME,
          ),
          desired,
        ],
      });
    } catch (error) {
      if (
        error instanceof B2AdministrationError &&
        error.code === "B2_CAPABILITY_REQUIRED"
      )
        return {
          status: "manual_required",
          metadata: { ...metadata, providerCapabilityMissing: true },
        };
      throw error;
    }
    const verified = await this.inspect(input.credentials);
    if (!verified.corsRules.some((rule) => equivalentCors(rule, desired)))
      throw new B2AdministrationError("B2_CORS_VERIFICATION_FAILED");
    return { status: "verified", metadata };
  }

  private async lifecycle(
    credentials: B2ManagedCredentials,
  ): Promise<LifecycleRule[]> {
    let result: { Rules?: LifecycleRule[] };
    try {
      result = (await this.s3Factory(credentials).send(
        new GetBucketLifecycleConfigurationCommand({
          Bucket: credentials.bucket,
        }),
      )) as { Rules?: LifecycleRule[] };
    } catch (error) {
      if (
        typeof error === "object" &&
        error !== null &&
        "name" in error &&
        error.name === "NoSuchLifecycleConfiguration"
      )
        return [];
      if (isCapabilityError(error))
        throw new B2AdministrationError("B2_CAPABILITY_REQUIRED");
      throw new B2AdministrationError("B2_PROVIDER_ERROR");
    }
    return result.Rules ?? [];
  }

  async ensureNodeProxLifecycle(input: {
    credentials: B2ManagedCredentials;
    inspection: B2BucketInspection;
    recheckOnly: boolean;
  }): Promise<B2ConfigurationResult> {
    const desired = desiredNodeProxLifecycle();
    const metadata = {
      desiredLifecycleRuleId: NODEPROX_LIFECYCLE_RULE_ID,
      desiredLifecycleConfiguration: JSON.stringify(desired),
    };
    const raw = await this.lifecycle(input.credentials);
    const normalized = normalizeLifecycleRules(raw);
    if (harmfulMediaLifecycle(normalized.foreign))
      throw new B2AdministrationError("B2_MEDIA_LIFECYCLE_CONFLICT");
    if (
      normalized.nodeProx &&
      equivalentLifecycle(normalized.nodeProx, desired) &&
      normalized.markerValid
    )
      return { status: "verified", metadata };
    if (input.recheckOnly) return { status: "manual_required", metadata };
    const merged: LifecycleRule[] = [
      ...raw.filter(
        (rule) =>
          rule.ID !== NODEPROX_LIFECYCLE_RULE_ID &&
          rule.ID !== NODEPROX_LIFECYCLE_MARKER_RULE_ID,
      ),
      ...nodeProxLifecycleRules(desired),
    ];
    try {
      await this.s3Factory(input.credentials).send(
        new PutBucketLifecycleConfigurationCommand({
          Bucket: input.credentials.bucket,
          LifecycleConfiguration: { Rules: merged },
        }),
      );
    } catch (error) {
      if (isCapabilityError(error))
        return {
          status: "manual_required",
          metadata: { ...metadata, providerCapabilityMissing: true },
        };
      throw new B2AdministrationError("B2_PROVIDER_ERROR");
    }
    const verified = normalizeLifecycleRules(
      await this.lifecycle(input.credentials),
    );
    if (harmfulMediaLifecycle(verified.foreign))
      throw new B2AdministrationError("B2_MEDIA_LIFECYCLE_CONFLICT");
    if (
      !verified.nodeProx ||
      !equivalentLifecycle(verified.nodeProx, desired) ||
      !verified.markerValid
    )
      throw new B2AdministrationError("B2_LIFECYCLE_VERIFICATION_FAILED");
    return { status: "verified", metadata };
  }
}
