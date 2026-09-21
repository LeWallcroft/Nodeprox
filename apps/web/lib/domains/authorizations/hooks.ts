"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { queryKeys } from "../query-keys";
import {
  getSeriesCreationGrantHistory,
  invalidateSeriesCreationGrant,
  issueSeriesCreationGrant,
  lookupAdminUsers,
  listAdminSeriesCreationGrants,
  listMySeriesCreationGrants,
} from "./api";
import type {
  IssueSeriesCreationGrantInput,
  SeriesCreationGrantStatus,
} from "./types";

export function useMySeriesCreationGrants(
  status?: SeriesCreationGrantStatus,
  enabled = true,
) {
  return useQuery({
    queryKey: queryKeys.authorizations.mine(status),
    queryFn: () => listMySeriesCreationGrants(status),
    enabled,
    retry: false,
  });
}

export function useAvailableSeriesCreationGrants(enabled = true) {
  return useMySeriesCreationGrants("available", enabled);
}

export function useAdminSeriesCreationGrants(
  input: {
    status?: SeriesCreationGrantStatus | undefined;
    search?: string | undefined;
    targetUserId?: string | undefined;
    cursor?: string | undefined;
  },
  enabled = true,
) {
  return useQuery({
    queryKey: queryKeys.authorizations.admin(input),
    queryFn: () => listAdminSeriesCreationGrants(input),
    enabled,
    retry: false,
  });
}

export function useAdminUserLookup(search: string, enabled = true) {
  return useQuery({
    queryKey: queryKeys.users.lookup(search),
    queryFn: () => lookupAdminUsers(search ? { search } : undefined),
    enabled,
    retry: false,
  });
}

export function useIssueSeriesCreationGrant() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: IssueSeriesCreationGrantInput) =>
      issueSeriesCreationGrant(input),
    onSuccess: async () => {
      await queryClient.invalidateQueries({
        queryKey: queryKeys.authorizations.all,
      });
    },
  });
}

export function useInvalidateSeriesCreationGrant() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: invalidateSeriesCreationGrant,
    onSuccess: async (_result, grantId) => {
      await Promise.all([
        queryClient.invalidateQueries({
          queryKey: queryKeys.authorizations.all,
        }),
        queryClient.invalidateQueries({
          queryKey: queryKeys.authorizations.history(grantId),
        }),
      ]);
    },
  });
}

export function useSeriesCreationGrantHistory(grantId: string | null) {
  return useQuery({
    queryKey: queryKeys.authorizations.history(grantId ?? "none"),
    queryFn: () => getSeriesCreationGrantHistory(grantId as string),
    enabled: Boolean(grantId),
    retry: false,
  });
}

export function useDebouncedAuthorizationValue(value: string, delay = 300) {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const timer = window.setTimeout(() => setDebounced(value), delay);
    return () => window.clearTimeout(timer);
  }, [delay, value]);
  return debounced;
}
