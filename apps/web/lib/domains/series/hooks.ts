"use client";

import {
  type QueryClient,
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import { ApiError } from "../../api/types";
import { queryKeys } from "../query-keys";
import {
  assignSeriesResponsible,
  createSeries,
  deleteSeries,
  getSelectableSeriesChannels,
  getSeries,
  getSeriesCapabilities,
  listSeries,
  listSeriesResponsibleCandidates,
  updateSeries,
  getSeriesLifecycle,
  deactivateSeries,
  reactivateSeries,
  requestSeriesReactivation,
  approveSeriesReactivation,
  rejectSeriesReactivation,
} from "./api";
import type { SeriesInput } from "./types";

export function useSeriesList(state: "active" | "inactive" = "active") {
  return useQuery({
    queryKey: queryKeys.series.listForState(state),
    queryFn: () => listSeries(state),
    retry: false,
  });
}

export function useSeriesLifecycle(seriesId: string) {
  return useQuery({
    queryKey: queryKeys.series.lifecycle(seriesId),
    queryFn: () => getSeriesLifecycle(seriesId),
    enabled: Boolean(seriesId),
    retry: false,
  });
}

export function useSeriesLifecycleActions(seriesId: string) {
  const queryClient = useQueryClient();
  const refresh = async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: queryKeys.series.list }),
      queryClient.invalidateQueries({
        queryKey: queryKeys.series.detail(seriesId),
      }),
      queryClient.invalidateQueries({
        queryKey: queryKeys.series.lifecycle(seriesId),
      }),
      queryClient.invalidateQueries({
        queryKey: queryKeys.series.capabilities(seriesId),
      }),
    ]);
  };
  return {
    deactivate: useMutation({
      mutationFn: (input: {
        reason: NonNullable<import("./types").Series["inactiveReason"]>;
        reasonDetail?: string;
      }) => deactivateSeries(seriesId, input),
      onSuccess: refresh,
    }),
    reactivate: useMutation({
      mutationFn: (resolutionNote?: string) =>
        reactivateSeries(seriesId, resolutionNote),
      onSuccess: refresh,
    }),
    request: useMutation({
      mutationFn: (note?: string) => requestSeriesReactivation(seriesId, note),
      onSuccess: refresh,
    }),
    approve: useMutation({
      mutationFn: (input: { requestId: string; resolutionNote?: string }) =>
        approveSeriesReactivation(
          seriesId,
          input.requestId,
          input.resolutionNote,
        ),
      onSuccess: refresh,
    }),
    reject: useMutation({
      mutationFn: (input: { requestId: string; resolutionNote?: string }) =>
        rejectSeriesReactivation(
          seriesId,
          input.requestId,
          input.resolutionNote,
        ),
      onSuccess: refresh,
    }),
  };
}

export function useSelectableSeriesChannels(enabled: boolean) {
  return useQuery({
    queryKey: queryKeys.discord.seriesChannels,
    queryFn: getSelectableSeriesChannels,
    enabled,
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
      await refreshSeriesCreationProjections(queryClient);
    },
    onError: async (error) => {
      if (
        error instanceof ApiError &&
        [
          "series-creation-grant-not-found",
          "series-creation-grant-not-owned",
          "series-creation-grant-already-consumed",
          "series-creation-grant-invalidated",
        ].includes(error.code ?? "")
      )
        await refreshSeriesCreationGrantProjections(queryClient);
    },
  });
}

export function refreshSeriesCreationGrantProjections(
  queryClient: Pick<QueryClient, "invalidateQueries">,
) {
  return queryClient.invalidateQueries({
    queryKey: queryKeys.authorizations.all,
  });
}

export function refreshSeriesCreationProjections(
  queryClient: Pick<QueryClient, "invalidateQueries">,
) {
  return Promise.all([
    queryClient.invalidateQueries({ queryKey: queryKeys.series.list }),
    refreshSeriesCreationGrantProjections(queryClient),
  ]);
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

export function useSeriesResponsibleCandidates(
  seriesId: string,
  enabled: boolean,
) {
  return useQuery({
    queryKey: queryKeys.series.responsibleCandidates(seriesId),
    queryFn: () => listSeriesResponsibleCandidates(seriesId),
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
    queryClient.invalidateQueries({
      queryKey: queryKeys.series.detail(seriesId),
    }),
    queryClient.invalidateQueries({
      queryKey: queryKeys.series.capabilities(seriesId),
    }),
  ]);
}

export function useAssignSeriesResponsible(seriesId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (responsibleUserId: string) =>
      assignSeriesResponsible(seriesId, responsibleUserId),
    onSuccess: async () => {
      await invalidateSeriesAssignment(queryClient, seriesId);
    },
  });
}
