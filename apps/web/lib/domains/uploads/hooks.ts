"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { invalidateChapterLifecycle } from "../chapters/lifecycle-invalidation";
import { uploadChapter } from "./api";

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
