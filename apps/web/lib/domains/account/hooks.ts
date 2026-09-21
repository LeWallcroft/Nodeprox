"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  changePassword,
  completePasswordReset,
  getPreferences,
  getProfile,
  getSessions,
  requestPasswordReset,
  revokeOtherSessions,
  revokeSession,
  updatePreferences,
  updateProfile,
} from "./api";

const profileKey = ["account", "profile"] as const;
const sessionsKey = ["account", "sessions"] as const;
const preferencesKey = ["account", "preferences"] as const;
export const useProfile = () =>
  useQuery({ queryKey: profileKey, queryFn: getProfile, retry: false });
export const useSessions = () =>
  useQuery({ queryKey: sessionsKey, queryFn: getSessions, retry: false });
export const usePreferences = () =>
  useQuery({ queryKey: preferencesKey, queryFn: getPreferences, retry: false });
export function useUpdatePreferences() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: updatePreferences,
    onSuccess: () => client.invalidateQueries({ queryKey: preferencesKey }),
  });
}
export function useUpdateProfile() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: updateProfile,
    onSuccess: () => client.invalidateQueries({ queryKey: profileKey }),
  });
}
export function useChangePassword() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: changePassword,
    onSuccess: () => client.invalidateQueries({ queryKey: sessionsKey }),
  });
}
export function useRevokeSession() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: revokeSession,
    onSuccess: () => client.invalidateQueries({ queryKey: sessionsKey }),
  });
}
export function useRevokeOtherSessions() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: revokeOtherSessions,
    onSuccess: () => client.invalidateQueries({ queryKey: sessionsKey }),
  });
}
export const useRequestPasswordReset = () =>
  useMutation({ mutationFn: requestPasswordReset });
export const useCompletePasswordReset = () =>
  useMutation({
    mutationFn: ({
      token,
      newPassword,
    }: {
      token: string;
      newPassword: string;
    }) => completePasswordReset(token, newPassword),
  });
