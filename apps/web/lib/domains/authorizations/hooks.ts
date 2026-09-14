"use client";

import { useQuery } from "@tanstack/react-query";
import { queryKeys } from "../query-keys";
import {
  listAdminSeriesCreationGrants,
  listMySeriesCreationGrants,
} from "./api";
import type { SeriesCreationGrantStatus } from "./types";

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
  status?: SeriesCreationGrantStatus,
  enabled = true,
) {
  return useQuery({
    queryKey: queryKeys.authorizations.admin(status),
    queryFn: () =>
      listAdminSeriesCreationGrants(status ? { status } : undefined),
    enabled,
    retry: false,
  });
}
