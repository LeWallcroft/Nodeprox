"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { queryKeys } from "../query-keys";
import { uploadChapter } from "./api";

export function useUploadChapter(seriesId: string, chapterId: string) {
  const queryClient = useQueryClient();
  const [progress, setProgress] = useState(0);
  const mutation = useMutation({
    mutationFn: (file: File) => {
      setProgress(0);
      return uploadChapter(chapterId, file, ({ loadedBytes, totalBytes }) => {
        setProgress(
          totalBytes > 0 ? Math.round((loadedBytes / totalBytes) * 100) : 0,
        );
      });
    },
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
  return { ...mutation, progress };
}
