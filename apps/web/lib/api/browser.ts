import { normalizeApiError, type ApiRequestOptions } from "./types";

const apiBaseUrl =
  process.env.NEXT_PUBLIC_NODEPROX_API_URL ?? "http://localhost:3001";

export async function apiRequestBrowser<T>(
  path: string,
  options: ApiRequestOptions = {},
): Promise<T> {
  const response = await fetch(`${apiBaseUrl}${path}`, {
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
