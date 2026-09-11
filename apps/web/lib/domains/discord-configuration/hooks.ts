"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { queryKeys } from "../query-keys";
import {
  getDiscordAuthorizationConfiguration,
  replaceDiscordAuthorizationConfiguration,
} from "./api";
import type { DiscordAuthorizationConfiguration } from "./types";

export function useDiscordAuthorizationConfiguration() {
  return useQuery({
    queryKey: queryKeys.discord.authorizationConfiguration,
    queryFn: getDiscordAuthorizationConfiguration,
    retry: false,
  });
}

export function useReplaceDiscordAuthorizationConfiguration() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (roles: DiscordAuthorizationConfiguration["roles"]) =>
      replaceDiscordAuthorizationConfiguration(roles),
    onSuccess: (configuration) =>
      queryClient.setQueryData(
        queryKeys.discord.authorizationConfiguration,
        configuration,
      ),
  });
}
