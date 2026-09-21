"use client";

import {
  type QueryClient,
  useMutation,
  useQueryClient,
} from "@tanstack/react-query";
import { useCallback, useRef, useState } from "react";
import { queryKeys } from "../query-keys";
import { replaceChapterImage } from "./api";
import type { ImageReplacementPhase } from "./types";

type ActiveImageReplacementPhase = Exclude<
  ImageReplacementPhase,
  "idle" | "success" | "error"
>;

/**
 * Table, selected-image panel, vertical viewer, and quick-images dialog all
 * consume this single Chapter-scoped public projection.
 */
export function refreshImageReplacementQueue(
  queryClient: Pick<QueryClient, "invalidateQueries">,
) {
  return queryClient.invalidateQueries({
    queryKey: queryKeys.uploads.operations,
  });
}

export function useReplaceChapterImage() {
  const queryClient = useQueryClient();
  const [phase, setPhase] = useState<ImageReplacementPhase>("idle");
  const [failurePhase, setFailurePhase] =
    useState<ActiveImageReplacementPhase | null>(null);
  const activePhase = useRef<ActiveImageReplacementPhase>("preparing");
  const updatePhase = useCallback((nextPhase: ActiveImageReplacementPhase) => {
    activePhase.current = nextPhase;
    setPhase(nextPhase);
  }, []);
  const mutation = useMutation({
    mutationFn: async (input: {
      chapterId: string;
      imageId: string;
      file: File;
    }) =>
      replaceChapterImage({
        ...input,
        onPhase: updatePhase,
      }),
    onMutate: () => setFailurePhase(null),
    onError: () => {
      setFailurePhase(activePhase.current);
      setPhase("error");
    },
    onSuccess: () => {
      // The API accepted durable background work; publication is refreshed
      // when the global operation projection reaches a terminal state.
      void refreshImageReplacementQueue(queryClient).catch(() => undefined);
      setPhase("success");
    },
  });
  const reset = useCallback(() => {
    mutation.reset();
    setFailurePhase(null);
    setPhase("idle");
  }, [mutation]);

  return { ...mutation, phase, failurePhase, reset };
}
