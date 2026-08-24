"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { queryKeys } from "../query-keys";
import { uploadChapter } from "./api";

export function useUploadChapter(seriesId: string, chapterId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (file: File) => uploadChapter(chapterId, file),
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({
          queryKey: queryKeys.chapters.detail(chapterId),
        }),
        queryClient.invalidateQueries({
          queryKey: queryKeys.series.chapters(seriesId),
        }),
      ]);
    },
  });
}
