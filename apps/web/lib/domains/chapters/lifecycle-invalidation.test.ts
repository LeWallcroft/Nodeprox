import { QueryClient } from "@tanstack/react-query";
import { describe, expect, it, vi } from "vitest";
import { queryKeys } from "../query-keys";
import { invalidateChapterLifecycle } from "./lifecycle-invalidation";

describe("Chapter lifecycle invalidation", () => {
  it("invalidates only Chapter-related projections", async () => {
    const client = new QueryClient();
    const invalidate = vi.spyOn(client, "invalidateQueries");

    await invalidateChapterLifecycle(client, {
      seriesId: "series-1",
      chapterId: "chapter-1",
      batchId: "batch-1",
    });

    expect(invalidate).toHaveBeenCalledWith({
      queryKey: queryKeys.series.chapters("series-1"),
    });
    expect(invalidate).toHaveBeenCalledWith({
      queryKey: queryKeys.chapters.detail("chapter-1"),
    });
    expect(invalidate).toHaveBeenCalledWith({
      queryKey: queryKeys.ingestion.batch("batch-1"),
    });
    expect(invalidate).toHaveBeenCalledWith({ queryKey: queryKeys.overview });
    expect(invalidate).toHaveBeenCalledTimes(7);
  });
});
