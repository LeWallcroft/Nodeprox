"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { queryKeys } from "../query-keys";
import {
  createSeries,
  deleteSeries,
  getSeries,
  listSeries,
  updateSeries,
} from "./api";
import type { SeriesInput } from "./types";

export function useSeriesList() {
  return useQuery({
    queryKey: queryKeys.series.list,
    queryFn: listSeries,
    retry: false,
  });
}

export function useSeries(seriesId: string) {
  return useQuery({
    queryKey: queryKeys.series.detail(seriesId),
    queryFn: () => getSeries(seriesId),
    enabled: Boolean(seriesId),
    retry: false,
  });
}

export function useCreateSeries() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: createSeries,
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: queryKeys.series.list });
    },
  });
}

export function useUpdateSeries(seriesId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: Partial<SeriesInput>) => updateSeries(seriesId, input),
    onSuccess: async (series) => {
      queryClient.setQueryData(queryKeys.series.detail(seriesId), series);
      await queryClient.invalidateQueries({ queryKey: queryKeys.series.list });
    },
  });
}

export function useDeleteSeries() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: deleteSeries,
    onSuccess: async (_data, seriesId) => {
      queryClient.removeQueries({
        queryKey: queryKeys.series.detail(seriesId),
      });
      await queryClient.invalidateQueries({ queryKey: queryKeys.series.list });
    },
  });
}
