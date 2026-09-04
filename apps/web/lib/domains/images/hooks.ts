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
export function refreshChapterImageProjections(
  queryClient: Pick<QueryClient, "invalidateQueries">,
  chapterId: string,
) {
  return queryClient.invalidateQueries({
    queryKey: queryKeys.publication.chapter(chapterId),
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
    onSuccess: (_result, input) => {
      // A refetch failure does not undo a completed server-side replacement.
      void refreshChapterImageProjections(queryClient, input.chapterId).catch(
        () => undefined,
      );
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
