import { apiRequestBrowser } from "../../api/browser";
import type { Series, SeriesInput } from "./types";

export function listSeries() {
  return apiRequestBrowser<Series[]>("/series");
}

export function getSeries(seriesId: string) {
  return apiRequestBrowser<Series>(`/series/${seriesId}`);
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
