import { apiRequestBrowser } from "../../api/browser";
import type {
  SelectableDiscordSeriesChannel,
  Series,
  SeriesCapabilitiesProjection,
  SeriesInput,
  SeriesListProjection,
  SeriesLifecycleDetail,
  SeriesResponsibleCandidate,
} from "./types";

export function getSelectableSeriesChannels() {
  return apiRequestBrowser<{ items: SelectableDiscordSeriesChannel[] }>(
    "/me/discord/series-channels",
  );
}

export function listSeries(operationalState: "active" | "inactive" = "active") {
  return apiRequestBrowser<SeriesListProjection[]>(
    `/series?operationalState=${operationalState}`,
  );
}

export function getSeriesLifecycle(seriesId: string) {
  return apiRequestBrowser<SeriesLifecycleDetail>(
    `/series/${seriesId}/lifecycle`,
  );
}

function lifecyclePost<T>(path: string, body: object = {}) {
  return apiRequestBrowser<T>(path, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

export function deactivateSeries(
  seriesId: string,
  input: {
    reason: NonNullable<Series["inactiveReason"]>;
    reasonDetail?: string;
  },
) {
  return lifecyclePost(`/series/${seriesId}/deactivate`, input);
}
export function reactivateSeries(seriesId: string, resolutionNote?: string) {
  return lifecyclePost(`/series/${seriesId}/reactivate`, { resolutionNote });
}
export function requestSeriesReactivation(seriesId: string, note?: string) {
  return lifecyclePost<{ requestId: string }>(
    `/series/${seriesId}/reactivation-requests`,
    { note },
  );
}
export function approveSeriesReactivation(
  seriesId: string,
  requestId: string,
  resolutionNote?: string,
) {
  return lifecyclePost(
    `/series/${seriesId}/reactivation-requests/${requestId}/approve`,
    { resolutionNote },
  );
}
export function rejectSeriesReactivation(
  seriesId: string,
  requestId: string,
  resolutionNote?: string,
) {
  return lifecyclePost(
    `/series/${seriesId}/reactivation-requests/${requestId}/reject`,
    { resolutionNote },
  );
}

export function getSeries(seriesId: string) {
  return apiRequestBrowser<Series>(`/series/${seriesId}`);
}

export function getSeriesCapabilities(seriesId: string) {
  return apiRequestBrowser<SeriesCapabilitiesProjection>(
    `/series/${seriesId}/capabilities`,
  );
}

export function createSeries(input: SeriesInput) {
  return apiRequestBrowser<Series>("/series", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(input),
  });
}

export function updateSeries(seriesId: string, input: Partial<SeriesInput>) {
  return apiRequestBrowser<Series>(`/series/${seriesId}`, {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(input),
  });
}

export function deleteSeries(seriesId: string) {
  return apiRequestBrowser<void>(`/series/${seriesId}`, { method: "DELETE" });
}

export function listSeriesResponsibleCandidates(seriesId: string) {
  return apiRequestBrowser<SeriesResponsibleCandidate[]>(
    `/series/${seriesId}/responsible-candidates`,
  );
}

export function assignSeriesResponsible(
  seriesId: string,
  responsibleUserId: string,
) {
  return apiRequestBrowser<void>(`/series/${seriesId}/responsible`, {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ responsibleUserId }),
  });
}
