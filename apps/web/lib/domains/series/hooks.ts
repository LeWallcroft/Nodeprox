"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { queryKeys } from "../query-keys";
import {
  createSeries,
  assignSeriesUploader,
  clearSeriesUploader,
  deleteSeries,
  getSeries,
  getSeriesCapabilities,
  listSeries,
  listSeriesUploaderCandidates,
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

export function useSeriesCapabilities(seriesId: string) {
  return useQuery({
    queryKey: queryKeys.series.capabilities(seriesId),
    queryFn: () => getSeriesCapabilities(seriesId),
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

export function useSeriesUploaderCandidates(seriesId: string, enabled: boolean) {
  return useQuery({
    queryKey: queryKeys.series.uploaderCandidates(seriesId),
    queryFn: () => listSeriesUploaderCandidates(seriesId),
    enabled: Boolean(seriesId) && enabled,
    retry: false,
  });
}

function invalidateSeriesAssignment(
  queryClient: ReturnType<typeof useQueryClient>,
  seriesId: string,
) {
  return Promise.all([
    queryClient.invalidateQueries({ queryKey: queryKeys.series.list }),
    queryClient.invalidateQueries({ queryKey: queryKeys.series.detail(seriesId) }),
    queryClient.invalidateQueries({
      queryKey: queryKeys.series.capabilities(seriesId),
    }),
  ]);
}

export function useAssignSeriesUploader(seriesId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (uploaderId: string) => assignSeriesUploader(seriesId, uploaderId),
    onSuccess: async () => {
      await invalidateSeriesAssignment(queryClient, seriesId);
    },
  });
}

export function useClearSeriesUploader(seriesId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () => clearSeriesUploader(seriesId),
    onSuccess: async () => {
      await invalidateSeriesAssignment(queryClient, seriesId);
    },
  });
}
