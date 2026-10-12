import {
  type ApiRequestOptions,
  ApiUnavailableError,
  normalizeApiError,
} from "./types";

const sameOriginApiPrefix = "/api";

export async function apiRequestBrowser<T>(
  path: string,
  options: ApiRequestOptions = {},
): Promise<T> {
  let response: Response;
  try {
    response = await fetch(`${sameOriginApiPrefix}${path}`, {
      ...options,
      cache: "no-store",
      credentials: "include",
    });
  } catch (error) {
    if (
      options.signal?.aborted ||
      (error instanceof Error && error.name === "AbortError")
    )
      throw error;
    throw new ApiUnavailableError();
  }
  if (!response.ok) {
    let payload: unknown;
    try {
      payload = await response.json();
    } catch {
      payload = undefined;
    }
    throw normalizeApiError(response.status, payload);
  }
  if (response.status === 204) return undefined as T;
  return (await response.json()) as T;
}
