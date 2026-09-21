import { apiRequestBrowser } from "../../api/browser";
import type {
  ManagedUser,
  ManagedUserPage,
  ManagedUserRole,
  ManagedUserStatus,
  ReviewUserInput,
} from "./types";

export function listManagedUsers() {
  return apiRequestBrowser<ManagedUser[]>("/admin/users");
}

export function listManagedUsersPage(input: {
  search?: string;
  role?: ManagedUserRole;
  status?: ManagedUserStatus;
  cursor?: string | null;
  limit: number;
}) {
  const params = new URLSearchParams({ limit: String(input.limit) });
  if (input.search) params.set("search", input.search);
  if (input.role) params.set("role", input.role);
  if (input.status) params.set("status", input.status);
  if (input.cursor) params.set("cursor", input.cursor);
  return apiRequestBrowser<ManagedUserPage>(
    `/admin/users/management?${params.toString()}`,
  );
}

export function reviewManagedUser(userId: string, input: ReviewUserInput) {
  return apiRequestBrowser<ManagedUser>(`/admin/users/${userId}`, {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(input),
  });
}

export function replaceManagedUserSeries(
  userId: string,
  seriesIds: readonly string[],
) {
  return apiRequestBrowser<{
    assigned: number;
    released: number;
    unchanged: number;
  }>(`/admin/users/${userId}/series-responsibilities`, {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ seriesIds }),
  });
}
