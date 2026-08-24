import { apiRequestBrowser } from "../../api/browser";
import type { LoginInput } from "./types";

export function login(input: LoginInput) {
  return apiRequestBrowser<void>("/auth/login", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(input),
  });
}

export function logout() {
  return apiRequestBrowser<void>("/auth/logout", { method: "POST" });
}
