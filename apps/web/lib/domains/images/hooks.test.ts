import { describe, expect, it, vi } from "vitest";
import { queryKeys } from "../query-keys";
import { refreshImageReplacementQueue } from "./hooks";

describe("image replacement refresh policy", () => {
  it("refreshes the global durable operation projection after queue acceptance", async () => {
    const invalidateQueries = vi.fn().mockResolvedValue(undefined);

    await refreshImageReplacementQueue({ invalidateQueries });

    expect(invalidateQueries).toHaveBeenCalledTimes(1);
    expect(invalidateQueries).toHaveBeenCalledWith({
      queryKey: queryKeys.uploads.operations,
    });
  });

  it("does not invalidate global, identity, or unrelated Chapter query keys", async () => {
    const invalidateQueries = vi.fn().mockResolvedValue(undefined);

    await refreshImageReplacementQueue({ invalidateQueries });

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
    expect(invalidateQueries).not.toHaveBeenCalledWith({
      queryKey: queryKeys.publication.chapter("chapter-1"),
    });
  });
});
