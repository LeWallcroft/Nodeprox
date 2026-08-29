import { apiRequestBrowser } from "../../api/browser";
import type { ManagedUser, ReviewUserInput } from "./types";

export function listManagedUsers() {
  return apiRequestBrowser<ManagedUser[]>("/admin/users");
}

export function reviewManagedUser(userId: string, input: ReviewUserInput) {
  return apiRequestBrowser<ManagedUser>(`/admin/users/${userId}`, {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(input),
  });
}
