import { headers } from "next/headers";
import { normalizeApiError, type ApiRequestOptions } from "./types";

const apiBaseUrl = process.env.NODEPROX_API_URL ?? "http://localhost:3001";

export async function apiRequestServer<T>(
  path: string,
  options: ApiRequestOptions = {},
): Promise<T> {
  const incomingHeaders = await headers();
  const requestHeaders = new Headers(options.headers);
  const cookie = incomingHeaders.get("cookie");
  if (cookie) requestHeaders.set("cookie", cookie);
  const response = await fetch(`${apiBaseUrl}${path}`, {
    ...options,
    headers: requestHeaders,
    cache: "no-store",
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
