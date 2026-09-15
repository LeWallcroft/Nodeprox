export interface ApiRequestOptions extends RequestInit {
  headers?: HeadersInit;
}

export interface ProblemDetails {
  type?: string;
  title?: string;
  status?: number;
  detail?: string;
  instance?: string;
  code?: string;
  category?:
    | "validation"
    | "authentication"
    | "authorization"
    | "not_found"
    | "conflict"
    | "business_rule"
    | "rate_limit"
    | "external_dependency"
    | "internal";
  requestId?: string;
  errors?: readonly unknown[];
}

export interface AuthenticatedUserView {
  id: string;
  email: string;
  status?: string;
}

export interface SessionView {
  user: AuthenticatedUserView;
  session: { id: string };
}

export class ApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
    readonly code?: string,
    readonly details?: ProblemDetails,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

export class ApiUnavailableError extends Error {
  readonly code = "api-unavailable";
  readonly status = 503;

  constructor() {
    super("api-unavailable");
    this.name = "ApiUnavailableError";
  }
}

export function normalizeApiError(status: number, payload?: unknown): ApiError {
  const body = isProblemDetails(payload) ? payload : undefined;
  const message =
    typeof body?.detail === "string" && body.detail.trim()
      ? body.detail
      : `API request failed (${status})`;
  return new ApiError(status, message, body?.code, body);
}

function isProblemDetails(payload: unknown): payload is ProblemDetails {
  return typeof payload === "object" && payload !== null;
}
