"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useCallback, useEffect, useRef, useState } from "react";
import { queryKeys } from "../query-keys";
import { getChapterReplacement, startChapterReplacement } from "./api";
import type {
  ChapterReplacementProjection,
  WholeChapterReplacementPhase,
} from "./types";

const activeStatuses = new Set<ChapterReplacementProjection["status"]>([
  "pending_upload",
  "uploaded",
  "processing",
  "ready",
  "completing",
]);

export function isChapterReplacementActive(
  status: ChapterReplacementProjection["status"],
): boolean {
  return activeStatuses.has(status);
}

export function replacementPhase(
  status: ChapterReplacementProjection["status"],
): WholeChapterReplacementPhase {
  if (status === "pending_upload") return "uploading";
  if (status === "uploaded" || status === "processing") return "processing";
  if (status === "ready" || status === "completing") return "applying";
  return status;
}

export async function refreshChapterReplacementProjections(
  queryClient: ReturnType<typeof useQueryClient>,
  input: { chapterId: string; seriesId: string },
) {
  await Promise.allSettled([
    queryClient.invalidateQueries({
      queryKey: queryKeys.publication.chapter(input.chapterId),
    }),
    queryClient.invalidateQueries({
      queryKey: queryKeys.chapters.detail(input.chapterId),
    }),
    queryClient.invalidateQueries({
      queryKey: queryKeys.series.chapters(input.seriesId),
    }),
    queryClient.invalidateQueries({ queryKey: queryKeys.chapters.list }),
  ]);
}

export function useWholeChapterReplacement(input: {
  chapterId: string;
  seriesId: string;
}) {
  const { chapterId, seriesId } = input;
  const queryClient = useQueryClient();
  const [replacementId, setReplacementId] = useState<string | null>(null);
  const [phase, setPhase] = useState<WholeChapterReplacementPhase>("idle");
  const [projection, setProjection] =
    useState<ChapterReplacementProjection | null>(null);
  const [uploadProgress, setUploadProgress] = useState<{
    loadedBytes: number;
    totalBytes: number;
  } | null>(null);
  const refreshedReplacement = useRef<string | null>(null);

  const statusQuery = useQuery({
    queryKey: queryKeys.chapters.replacement(
      chapterId,
      replacementId ?? "inactive",
    ),
    queryFn: () =>
      getChapterReplacement({
        chapterId,
        replacementId: replacementId ?? "",
      }),
    enabled:
      Boolean(replacementId) &&
      projection !== null &&
      isChapterReplacementActive(projection.status),
    retry: false,
    refetchInterval: () =>
      projection && isChapterReplacementActive(projection.status)
        ? 2000
        : false,
  });

  const acceptProjection = useCallback(
    (next: ChapterReplacementProjection) => {
      setProjection(next);
      setPhase(replacementPhase(next.status));
      if (
        next.status === "completed" &&
        refreshedReplacement.current !== next.replacementId
      ) {
        refreshedReplacement.current = next.replacementId;
        void refreshChapterReplacementProjections(queryClient, {
          chapterId,
          seriesId,
        });
      }
    },
    [chapterId, queryClient, seriesId],
  );

  useEffect(() => {
    if (statusQuery.data) acceptProjection(statusQuery.data);
  }, [acceptProjection, statusQuery.data]);

  const mutation = useMutation({
    mutationFn: (file: File) => {
      setPhase("uploading");
      return startChapterReplacement({
        chapterId,
        file,
        onUploadProgress: (loadedBytes, totalBytes) =>
          setUploadProgress({ loadedBytes, totalBytes }),
      });
    },
    onSuccess: (next) => {
      setReplacementId(next.replacementId);
      acceptProjection(next);
    },
    onError: () => setPhase("failed"),
  });

  const select = useCallback(() => setPhase("selected"), []);
  const reset = useCallback(() => {
    mutation.reset();
    setReplacementId(null);
    setProjection(null);
    setUploadProgress(null);
    setPhase("idle");
  }, [mutation]);

  return {
    phase,
    projection,
    uploadProgress,
    error: mutation.error ?? statusQuery.error,
    isActive:
      mutation.isPending ||
      (projection ? isChapterReplacementActive(projection.status) : false),
    select,
    start: mutation.mutateAsync,
    reset,
  };
}
