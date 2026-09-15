import { NodeProxApiError } from "../infrastructure/nodeprox-api/nodeprox-api.client.js";

export type StartupRetryPolicy = {
  readonly maxAttempts: number;
  shouldRetry(error: unknown, attempt: number, elapsedMs: number): boolean;
  delayMs(attempt: number): number;
};

export const DEFAULT_STARTUP_RETRY_POLICY: StartupRetryPolicy = {
  maxAttempts: 6,
  shouldRetry(error, attempt, elapsedMs) {
    if (attempt >= 6 || elapsedMs >= 30_000) return false;
    return (
      error instanceof NodeProxApiError &&
      (error.status === 0 || error.status >= 500)
    );
  },
  delayMs(attempt) {
    const baseDelayMs = Math.min(500 * 2 ** (attempt - 1), 8_000);
    const jitter = 0.8 + Math.random() * 0.4;
    return Math.round(baseDelayMs * jitter);
  },
};

export function startupRetryErrorDetails(error: unknown) {
  if (error instanceof NodeProxApiError)
    return {
      status: error.status,
      category: error.status === 0 ? "transport" : "http",
    };
  return { status: null, category: "unknown" };
}
