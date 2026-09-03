import type { QueryClient } from "@tanstack/react-query";
import { queryKeys } from "../query-keys";

type ChapterLifecycleInvalidation = {
  seriesId: string;
  chapterId?: string | null;
  batchId?: string;
};

/** Invalidates only projections that expose persisted Chapter lifecycle. */
export function invalidateChapterLifecycle(
  queryClient: QueryClient,
  input: ChapterLifecycleInvalidation,
) {
  const invalidations = [
    queryClient.invalidateQueries({
      queryKey: queryKeys.series.chapters(input.seriesId),
    }),
    queryClient.invalidateQueries({ queryKey: queryKeys.chapters.list }),
    queryClient.invalidateQueries({
      queryKey: queryKeys.series.detail(input.seriesId),
    }),
    queryClient.invalidateQueries({ queryKey: queryKeys.overview }),
  ];

  if (input.chapterId) {
    invalidations.push(
      queryClient.invalidateQueries({
        queryKey: queryKeys.chapters.detail(input.chapterId),
      }),
      queryClient.invalidateQueries({
        queryKey: queryKeys.publication.chapter(input.chapterId),
      }),
    );
  }
  if (input.batchId)
    invalidations.push(
      queryClient.invalidateQueries({
        queryKey: queryKeys.ingestion.batch(input.batchId),
      }),
    );
  return Promise.all(invalidations);
}
