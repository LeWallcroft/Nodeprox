"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { queryKeys } from "../query-keys";
import { generateDiscordLinkCode, getDiscordLinkStatus } from "./api";

export function useDiscordLinkStatus() {
  return useQuery({
    queryKey: queryKeys.discord.linkStatus,
    queryFn: getDiscordLinkStatus,
    retry: false,
    refetchInterval: (query) =>
      query.state.data?.state === "pending" ? 5_000 : false,
  });
}

export function useGenerateDiscordLinkCode() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: generateDiscordLinkCode,
    onSuccess: async () => {
      await queryClient.invalidateQueries({
        queryKey: queryKeys.discord.linkStatus,
      });
    },
  });
}
