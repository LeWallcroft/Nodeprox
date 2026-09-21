import { apiRequestBrowser } from "../../api/browser";
import type {
  AdminUserLookupPage,
  AdminSeriesCreationGrantPage,
  GrantHistoryItem,
  IssuedSeriesCreationGrant,
  IssueSeriesCreationGrantInput,
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
  status?: SeriesCreationGrantStatus | undefined;
  search?: string | undefined;
  targetUserId?: string | undefined;
  cursor?: string | undefined;
}) {
  const params = new URLSearchParams({ limit: "10" });
  if (input?.status) params.set("status", input.status);
  if (input?.search) params.set("search", input.search);
  if (input?.targetUserId) params.set("targetUserId", input.targetUserId);
  if (input?.cursor) params.set("cursor", input.cursor);
  return apiRequestBrowser<AdminSeriesCreationGrantPage>(
    `/admin/series-creation-grants?${params.toString()}`,
  );
}

export function lookupAdminUsers(input?: { search?: string; cursor?: string }) {
  const params = new URLSearchParams({ limit: "20" });
  if (input?.search) params.set("search", input.search);
  if (input?.cursor) params.set("cursor", input.cursor);
  return apiRequestBrowser<AdminUserLookupPage>(
    `/admin/users/lookup?${params.toString()}`,
  );
}

export function issueSeriesCreationGrant(input: IssueSeriesCreationGrantInput) {
  return apiRequestBrowser<IssuedSeriesCreationGrant>(
    "/admin/series-creation-grants",
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(input),
    },
  );
}

export function invalidateSeriesCreationGrant(grantId: string) {
  return apiRequestBrowser<{ invalidated: true; idempotent: boolean }>(
    `/admin/series-creation-grants/${grantId}/invalidate`,
    { method: "POST" },
  );
}

export function getSeriesCreationGrantHistory(grantId: string) {
  return apiRequestBrowser<{ items: GrantHistoryItem[] }>(
    `/admin/series-creation-grants/${grantId}/history`,
  );
}
