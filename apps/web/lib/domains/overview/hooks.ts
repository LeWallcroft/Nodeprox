"use client";

import { useQuery } from "@tanstack/react-query";
import { queryKeys } from "../query-keys";
import { getOverview } from "./api";

export function useOverview() {
  return useQuery({
    queryKey: queryKeys.overview,
    queryFn: getOverview,
    retry: false,
  });
}
