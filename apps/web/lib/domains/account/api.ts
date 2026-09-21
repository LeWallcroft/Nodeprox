import { apiRequestBrowser } from "../../api/browser";

export type Profile = {
  id: string;
  email: string;
  displayName: string | null;
  role: "admin" | "gestor" | "uploader";
  status: string;
  createdAt: string;
  discordUsername: string | null;
  discordLinkedAt: string | null;
};
export type AccountSession = {
  id: string;
  createdAt: string;
  lastSeenAt: string | null;
  ip: string | null;
  userAgent: string | null;
  current: boolean;
};

export const getProfile = () => apiRequestBrowser<Profile>("/me/profile");
export const updateProfile = (displayName: string | null) =>
  apiRequestBrowser<Profile>("/me/profile", {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ displayName }),
  });
export type AccountPreferences = {
  theme?: "dark" | "system" | "light";
  locale?: string;
  timeZone?: string;
  reducedMotion?: boolean;
};
export const getPreferences = () =>
  apiRequestBrowser<{ preferences: AccountPreferences }>("/me/preferences");
export const updatePreferences = (preferences: AccountPreferences) =>
  apiRequestBrowser<{ preferences: AccountPreferences }>("/me/preferences", {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ preferences }),
  });
export const getSessions = () =>
  apiRequestBrowser<{ items: AccountSession[] }>("/me/sessions");
export const revokeSession = (sessionId: string) =>
  apiRequestBrowser<void>(`/me/sessions/${sessionId}`, { method: "DELETE" });
export const revokeOtherSessions = () =>
  apiRequestBrowser<{ revoked: number }>("/me/sessions/revoke-others", {
    method: "POST",
  });
export const changePassword = (input: {
  currentPassword: string;
  newPassword: string;
}) =>
  apiRequestBrowser<{ changed: true }>("/me/password/change", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(input),
  });
export const requestPasswordReset = (email: string) =>
  apiRequestBrowser<{ accepted: true }>("/auth/password-reset/request", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email }),
  });
export const completePasswordReset = (token: string, newPassword: string) =>
  apiRequestBrowser<{ reset: true }>("/auth/password-reset/complete", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ token, newPassword }),
  });
