export type TechnicalDependency =
  | "postgres"
  | "redis"
  | "b2"
  | "cloudflare"
  | "discord"
  | "brevo";

export class ExternalDependencyFailure extends Error {
  readonly code: string;
  readonly dependency: TechnicalDependency;
  readonly retryable: boolean;
  readonly providerCode: string | undefined;
  readonly providerRequestId: string | undefined;
  readonly httpStatus: number | undefined;

  constructor(input: {
    code: string;
    dependency: TechnicalDependency;
    retryable: boolean;
    providerCode?: string | undefined;
    providerRequestId?: string | undefined;
    httpStatus?: number | undefined;
    cause?: unknown;
  }) {
    super(input.code, { cause: input.cause });
    this.name = "ExternalDependencyFailure";
    this.code = input.code;
    this.dependency = input.dependency;
    this.retryable = input.retryable;
    this.providerCode = input.providerCode;
    this.providerRequestId = input.providerRequestId;
    this.httpStatus = input.httpStatus;
  }
}
