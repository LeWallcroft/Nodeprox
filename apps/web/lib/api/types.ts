import type { ProblemDetails, UserReference } from "@nodeprox/types";
export type { ProblemCategory, ProblemDetails } from "@nodeprox/types";

export interface ApiRequestOptions extends RequestInit {
  headers?: HeadersInit;
}

export interface AuthenticatedUserView extends UserReference {
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
    readonly details?: Partial<ProblemDetails>,
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

function isProblemDetails(
  payload: unknown,
): payload is Partial<ProblemDetails> {
  if (typeof payload !== "object" || payload === null || Array.isArray(payload))
    return false;
  const body = payload as Record<string, unknown>;
  if (
    !(
      [
        "type",
        "title",
        "status",
        "detail",
        "code",
        "category",
        "requestId",
      ] as const
    ).some((key) => key in body)
  )
    return false;
  if (
    body.status !== undefined &&
    (typeof body.status !== "number" || !Number.isFinite(body.status))
  )
    return false;
  if (body.type !== undefined && typeof body.type !== "string") return false;
  if (body.title !== undefined && typeof body.title !== "string") return false;
  if (body.code !== undefined && typeof body.code !== "string") return false;
  if (body.requestId !== undefined && typeof body.requestId !== "string")
    return false;
  if (body.detail !== undefined && typeof body.detail !== "string")
    return false;
  if (
    body.category !== undefined &&
    (typeof body.category !== "string" ||
      ![
        "validation",
        "authentication",
        "authorization",
        "not_found",
        "conflict",
        "business_rule",
        "rate_limit",
        "external_dependency",
        "internal",
      ].includes(body.category))
  )
    return false;
  return true;
}
