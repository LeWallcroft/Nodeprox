import { describe, expect, it, vi } from "vitest";
import { queryKeys } from "../query-keys";
import { refreshChapterImageProjections } from "./hooks";

describe("image replacement refresh policy", () => {
  it("invalidates only the replaced Chapter public-image projection", async () => {
    const invalidateQueries = vi.fn().mockResolvedValue(undefined);

    await refreshChapterImageProjections({ invalidateQueries }, "chapter-1");

    expect(invalidateQueries).toHaveBeenCalledTimes(1);
    expect(invalidateQueries).toHaveBeenCalledWith({
      queryKey: queryKeys.publication.chapter("chapter-1"),
    });
  });

  it("does not invalidate global, identity, or unrelated Chapter query keys", async () => {
    const invalidateQueries = vi.fn().mockResolvedValue(undefined);

    await refreshChapterImageProjections({ invalidateQueries }, "chapter-1");

    expect(invalidateQueries).not.toHaveBeenCalledWith({});
    expect(invalidateQueries).not.toHaveBeenCalledWith({
      queryKey: queryKeys.auth.capabilities,
    });
    expect(invalidateQueries).not.toHaveBeenCalledWith({
      queryKey: queryKeys.series.list,
    });
    expect(invalidateQueries).not.toHaveBeenCalledWith({
      queryKey: queryKeys.chapters.detail("chapter-2"),
    });
  });
});
