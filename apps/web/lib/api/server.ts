import { headers } from "next/headers";
import {
  ApiError,
  type ApiRequestOptions,
  ApiUnavailableError,
  normalizeApiError,
} from "./types";

const apiBaseUrl = process.env.NODEPROX_API_URL ?? "http://127.0.0.1:3001";

export type ServerApiRequestOptions = ApiRequestOptions & {
  retry?: "bootstrap";
};

export type ServerApiRequestDependencies = {
  fetcher?: typeof fetch;
  readHeaders?: () => Promise<Pick<Headers, "get">>;
  sleep?: (milliseconds: number) => Promise<void>;
};

const bootstrapRetryDelaysMs = [250, 500, 1_000] as const;
const bootstrapTimeoutMs = 5_000;

function isRetryableStatus(status: number) {
  return status >= 500 && status <= 504;
}

function logRetry(input: {
  path: string;
  attempt: number;
  delayMs: number;
  category: "transport" | "http";
  status: number | null;
}) {
  console.warn("web.ssr.api.retry", {
    pathCategory: input.path.startsWith("/auth/") ? "auth" : "other",
    attempt: input.attempt,
    maxAttempts: bootstrapRetryDelaysMs.length + 1,
    delayMs: input.delayMs,
    category: input.category,
    status: input.status,
  });
}

function logUnavailable(path: string) {
  console.error("web.ssr.api.unavailable", {
    pathCategory: path.startsWith("/auth/") ? "auth" : "other",
  });
}

const sleep = (milliseconds: number) =>
  new Promise<void>((resolve) => setTimeout(resolve, milliseconds));

export async function apiRequestServer<T>(
  path: string,
  options: ServerApiRequestOptions = {},
  dependencies: ServerApiRequestDependencies = {},
): Promise<T> {
  const incomingHeaders = await (dependencies.readHeaders ?? headers)();
  const requestHeaders = new Headers(options.headers);
  const cookie = incomingHeaders.get("cookie");
  if (cookie) requestHeaders.set("cookie", cookie);
  const { retry, ...requestOptions } = options;
  const fetcher = dependencies.fetcher ?? fetch;
  const wait = dependencies.sleep ?? sleep;
  const maxAttempts =
    retry === "bootstrap" ? bootstrapRetryDelaysMs.length + 1 : 1;

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      const response = await fetcher(`${apiBaseUrl}${path}`, {
        ...requestOptions,
        headers: requestHeaders,
        cache: "no-store",
        signal: requestOptions.signal
          ? AbortSignal.any([
              requestOptions.signal,
              AbortSignal.timeout(bootstrapTimeoutMs),
            ])
          : AbortSignal.timeout(bootstrapTimeoutMs),
      });
      if (response.ok) {
        if (response.status === 204) return undefined as T;
        return (await response.json()) as T;
      }
      if (retry === "bootstrap" && isRetryableStatus(response.status)) {
        if (attempt < maxAttempts) {
          const delayMs = bootstrapRetryDelaysMs[attempt - 1] ?? 1_000;
          logRetry({
            path,
            attempt,
            delayMs,
            category: "http",
            status: response.status,
          });
          await wait(delayMs);
          continue;
        }
        logUnavailable(path);
        throw new ApiUnavailableError();
      }
      let payload: unknown;
      try {
        payload = await response.json();
      } catch {
        payload = undefined;
      }
      throw normalizeApiError(response.status, payload);
    } catch (error) {
      if (error instanceof ApiUnavailableError || error instanceof ApiError)
        throw error;
      if (retry === "bootstrap" && attempt < maxAttempts) {
        const delayMs = bootstrapRetryDelaysMs[attempt - 1] ?? 1_000;
        logRetry({
          path,
          attempt,
          delayMs,
          category: "transport",
          status: null,
        });
        await wait(delayMs);
        continue;
      }
      logUnavailable(path);
      throw new ApiUnavailableError();
    }
  }

  throw new ApiUnavailableError();
}
