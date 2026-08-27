"use client";

import { useQuery } from "@tanstack/react-query";
import { queryKeys } from "../query-keys";
import { getPublicChapter } from "./api";

export function usePublicChapter(chapterId: string, enabled: boolean) {
  return useQuery({
    queryKey: queryKeys.publication.chapter(chapterId),
    queryFn: () => getPublicChapter(chapterId),
    enabled: Boolean(chapterId) && enabled,
    retry: false,
  });
}
