export interface ApiRequestOptions extends RequestInit {
  headers?: HeadersInit;
}

export interface ApiErrorPayload {
  code?: string;
  message?: string;
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
  ) {
    super(message);
    this.name = "ApiError";
  }
}

export function normalizeApiError(status: number, payload?: unknown): ApiError {
  const body = payload as ApiErrorPayload | null | undefined;
  const message =
    typeof body?.message === "string" && body.message.trim()
      ? body.message
      : `API request failed (${status})`;
  return new ApiError(
    status,
    message,
    typeof body?.code === "string" ? body.code : undefined,
  );
}
