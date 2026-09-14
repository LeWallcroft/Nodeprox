import { apiRequestBrowser } from "../../api/browser";
import type {
  AdminSeriesCreationGrantPage,
  SeriesCreationGrantListItem,
  SeriesCreationGrantStatus,
} from "./types";

export function listMySeriesCreationGrants(status?: SeriesCreationGrantStatus) {
  const query = status ? `?status=${encodeURIComponent(status)}` : "";
  return apiRequestBrowser<SeriesCreationGrantListItem[]>(
    `/me/series-creation-grants${query}`,
  );
}

export function listAdminSeriesCreationGrants(input?: {
  status?: SeriesCreationGrantStatus;
  cursor?: string;
}) {
  const params = new URLSearchParams({ limit: "50" });
  if (input?.status) params.set("status", input.status);
  if (input?.cursor) params.set("cursor", input.cursor);
  return apiRequestBrowser<AdminSeriesCreationGrantPage>(
    `/admin/series-creation-grants?${params.toString()}`,
  );
}
