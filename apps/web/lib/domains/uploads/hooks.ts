"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { invalidateChapterLifecycle } from "../chapters/lifecycle-invalidation";
import { uploadChapter } from "./api";
import { getUserUploadPolicy } from "./upload-policy";
import { queryKeys } from "../query-keys";

export function useUploadPolicy(enabled = true) {
  return useQuery({
    queryKey: queryKeys.uploads.policy,
    queryFn: getUserUploadPolicy,
    enabled,
    retry: false,
    staleTime: 5 * 60 * 1000,
  });
}

export function useUploadChapter(seriesId: string, chapterId: string) {
  const queryClient = useQueryClient();
  const [progress, setProgress] = useState(0);
  const mutation = useMutation({
    mutationFn: (file: File) => {
      setProgress(0);
      return uploadChapter(
        chapterId,
        file,
        ({ loadedBytes, totalBytes }) => {
          setProgress(
            totalBytes > 0 ? Math.round((loadedBytes / totalBytes) * 100) : 0,
          );
        },
        async () => {
          await invalidateChapterLifecycle(queryClient, {
            seriesId,
            chapterId,
          });
        },
      );
    },
    onSuccess: () =>
      invalidateChapterLifecycle(queryClient, { seriesId, chapterId }),
  });
  return { ...mutation, progress };
}
