import { normalizeApiError, type ApiRequestOptions } from "./types";

const sameOriginApiPrefix = "/api";

export async function apiRequestBrowser<T>(
  path: string,
  options: ApiRequestOptions = {},
): Promise<T> {
  const response = await fetch(`${sameOriginApiPrefix}${path}`, {
    ...options,
    credentials: "include",
  });
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
