import { apiRequestBrowser } from "../../api/browser";
import type {
  SelectableDiscordSeriesChannel,
  Series,
  SeriesCapabilitiesProjection,
  SeriesInput,
  SeriesResponsibleCandidate,
} from "./types";

export function getSelectableSeriesChannels() {
  return apiRequestBrowser<{ items: SelectableDiscordSeriesChannel[] }>(
    "/me/discord/series-channels",
  );
}

export function listSeries() {
  return apiRequestBrowser<Series[]>("/series");
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
