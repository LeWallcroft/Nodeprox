"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  getDiscordProfileSyncStatus,
  triggerDiscordProfileSync,
} from "./profile-sync-api";

export const discordProfileSyncKey = [
  "admin",
  "discord",
  "profile-sync",
] as const;

export function useDiscordProfileSyncStatus() {
  return useQuery({
    queryKey: discordProfileSyncKey,
    queryFn: getDiscordProfileSyncStatus,
    retry: false,
    refetchInterval: (query) => (query.state.data?.syncRunning ? 3000 : false),
  });
}

export function useTriggerDiscordProfileSync() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: triggerDiscordProfileSync,
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: discordProfileSyncKey });
    },
  });
}
