import { apiRequestBrowser } from "../../api/browser";
import type {
  Series,
  SeriesCapabilitiesProjection,
  SeriesInput,
  SeriesUploaderCandidate,
} from "./types";

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

export function listSeriesUploaderCandidates(seriesId: string) {
  return apiRequestBrowser<SeriesUploaderCandidate[]>(
    `/series/${seriesId}/uploader-candidates`,
  );
}

export function assignSeriesUploader(seriesId: string, uploaderId: string) {
  return apiRequestBrowser<void>(`/series/${seriesId}/uploader`, {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ uploaderId }),
  });
}

export function clearSeriesUploader(seriesId: string) {
  return apiRequestBrowser<void>(`/series/${seriesId}/uploader`, {
    method: "DELETE",
  });
}
