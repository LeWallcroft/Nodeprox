"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { queryKeys } from "../query-keys";
import {
  createChapter,
  deleteChapter,
  getChapter,
  listChapters,
  updateChapter,
} from "./api";
import type { ChapterInput } from "./types";

const ACTIVE_STATUSES = new Set(["uploading", "uploaded", "processing"]);

export function useChapterList(seriesId: string) {
  return useQuery({
    queryKey: queryKeys.series.chapters(seriesId),
    queryFn: () => listChapters(seriesId),
    enabled: Boolean(seriesId),
    retry: false,
  });
}

export function useChapter(chapterId: string) {
  return useQuery({
    queryKey: queryKeys.chapters.detail(chapterId),
    queryFn: () => getChapter(chapterId),
    enabled: Boolean(chapterId),
    retry: false,
    refetchInterval: (query) =>
      query.state.data && ACTIVE_STATUSES.has(query.state.data.status)
        ? 2000
        : false,
  });
}

export function useCreateChapter(seriesId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: ChapterInput) => createChapter(seriesId, input),
    onSuccess: async () => {
      await queryClient.invalidateQueries({
        queryKey: queryKeys.series.chapters(seriesId),
      });
    },
  });
}

export function useUpdateChapter(chapterId: string, seriesId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: Partial<ChapterInput>) =>
      updateChapter(chapterId, input),
    onSuccess: async (chapter) => {
      queryClient.setQueryData(queryKeys.chapters.detail(chapterId), chapter);
      await queryClient.invalidateQueries({
        queryKey: queryKeys.series.chapters(seriesId),
      });
    },
  });
}

export function useDeleteChapter(seriesId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: deleteChapter,
    onSuccess: async (_data, chapterId) => {
      queryClient.removeQueries({
        queryKey: queryKeys.chapters.detail(chapterId),
      });
      await queryClient.invalidateQueries({
        queryKey: queryKeys.series.chapters(seriesId),
      });
    },
  });
}
