"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  getDiscordProfileSyncStatus,
  getProductSettings,
  triggerDiscordProfileSync,
  updateProductSettings,
} from "./api";

const settingsKey = ["admin", "settings"] as const;
const discordProfileSyncKey = [
  "admin",
  "maintenance",
  "discord-profiles",
] as const;

export function useProductSettings() {
  return useQuery({
    queryKey: settingsKey,
    queryFn: getProductSettings,
    retry: false,
  });
}

export function useUpdateProductSettings() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: updateProductSettings,
    onSuccess: (settings) => queryClient.setQueryData(settingsKey, settings),
  });
}

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
