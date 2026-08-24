import { apiRequestBrowser } from "./browser";

export interface HealthResponse {
  status: "ok";
}

export function getApiHealth(signal?: AbortSignal) {
  return apiRequestBrowser<HealthResponse>("/health", signal ? { signal } : {});
}
