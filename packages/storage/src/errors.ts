export type StorageErrorDetails = {
  providerCode?: string | undefined;
  httpStatus?: number | undefined;
  providerRequestId?: string | undefined;
  cause?: unknown;
};

export abstract class StorageError extends Error {
  abstract readonly code: string;
  abstract readonly retryable: boolean;
  readonly providerCode: string | undefined;
  readonly httpStatus: number | undefined;
  readonly providerRequestId: string | undefined;

  protected constructor(message: string, details: StorageErrorDetails = {}) {
    super(message, { cause: details.cause });
    this.name = new.target.name;
    this.providerCode = details.providerCode;
    this.httpStatus = details.httpStatus;
    this.providerRequestId = details.providerRequestId;
  }
}

export class StorageProviderUnavailableError extends StorageError {
  readonly code = "STORAGE_PROVIDER_UNAVAILABLE";
  readonly retryable = true;
  constructor(details?: StorageErrorDetails) {
    super("Storage provider temporarily unavailable", details);
  }
}

export class StorageRateLimitedError extends StorageError {
  readonly code = "STORAGE_RATE_LIMITED";
  readonly retryable = true;
  constructor(details?: StorageErrorDetails) {
    super("Storage provider rate limited the request", details);
  }
}

export class StorageAuthenticationError extends StorageError {
  readonly code = "STORAGE_AUTHENTICATION_FAILED";
  readonly retryable = false;
  constructor(details?: StorageErrorDetails) {
    super("Storage authentication failed", details);
  }
}

export class StorageObjectNotFoundError extends StorageError {
  readonly code = "STORAGE_OBJECT_NOT_FOUND";
  readonly retryable = false;
  constructor(details?: StorageErrorDetails) {
    super("Storage object not found", details);
  }
}

export class StorageObjectAlreadyExistsError extends StorageError {
  readonly code = "STORAGE_OBJECT_ALREADY_EXISTS";
  readonly retryable = false;
  constructor(details?: StorageErrorDetails) {
    super("Storage object already exists", details);
  }
}

export class StorageIntegrityError extends StorageError {
  readonly code = "STORAGE_INTEGRITY_FAILED";
  readonly retryable = false;
  constructor(details?: StorageErrorDetails) {
    super("Storage object integrity check failed", details);
  }
}

export class StorageUnknownError extends StorageError {
  readonly code = "STORAGE_UNKNOWN";
  readonly retryable = false;
  constructor(details?: StorageErrorDetails) {
    super("Unknown storage provider failure", details);
  }
}

type ProviderError = {
  name?: unknown;
  code?: unknown;
  Code?: unknown;
  $metadata?: {
    httpStatusCode?: unknown;
    requestId?: unknown;
    extendedRequestId?: unknown;
  };
};

export function mapStorageProviderError(error: unknown): StorageError {
  if (error instanceof StorageError) return error;
  const provider =
    typeof error === "object" && error !== null ? (error as ProviderError) : {};
  const providerCode = [provider.Code, provider.code, provider.name].find(
    (value): value is string => typeof value === "string",
  );
  const httpStatus =
    typeof provider.$metadata?.httpStatusCode === "number"
      ? provider.$metadata.httpStatusCode
      : undefined;
  const providerRequestId = [
    provider.$metadata?.requestId,
    provider.$metadata?.extendedRequestId,
  ].find((value): value is string => typeof value === "string");
  const details = { providerCode, httpStatus, providerRequestId, cause: error };

  if (
    httpStatus === 404 ||
    providerCode === "NoSuchKey" ||
    providerCode === "NotFound"
  )
    return new StorageObjectNotFoundError(details);
  if (
    httpStatus === 401 ||
    httpStatus === 403 ||
    providerCode === "InvalidAccessKeyId" ||
    providerCode === "SignatureDoesNotMatch" ||
    providerCode === "AccessDenied"
  )
    return new StorageAuthenticationError(details);
  if (
    httpStatus === 429 ||
    providerCode === "SlowDown" ||
    providerCode === "Throttling" ||
    providerCode === "TooManyRequests"
  )
    return new StorageRateLimitedError(details);
  if (
    [408, 500, 502, 503, 504].includes(httpStatus ?? 0) ||
    [
      "InternalError",
      "ServiceUnavailable",
      "RequestTimeout",
      "TimeoutError",
      "ECONNRESET",
      "ETIMEDOUT",
      "EAI_AGAIN",
    ].includes(providerCode ?? "")
  )
    return new StorageProviderUnavailableError(details);
  return new StorageUnknownError(details);
}
