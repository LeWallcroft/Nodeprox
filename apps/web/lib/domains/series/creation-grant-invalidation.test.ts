import { describe, expect, it, vi } from "vitest";
import { queryKeys } from "../query-keys";
import {
  refreshSeriesCreationGrantProjections,
  refreshSeriesCreationProjections,
} from "./hooks";

describe("Series creation grant refresh policy", () => {
  it("refreshes grants after an unavailable grant response", async () => {
    const invalidateQueries = vi.fn().mockResolvedValue(undefined);

    await refreshSeriesCreationGrantProjections({ invalidateQueries });

    expect(invalidateQueries).toHaveBeenCalledWith({
      queryKey: queryKeys.authorizations.all,
    });
  });

  it("refreshes both Series and grants after successful creation", async () => {
    const invalidateQueries = vi.fn().mockResolvedValue(undefined);

    await refreshSeriesCreationProjections({ invalidateQueries });

    expect(invalidateQueries).toHaveBeenCalledWith({
      queryKey: queryKeys.series.list,
    });
    expect(invalidateQueries).toHaveBeenCalledWith({
      queryKey: queryKeys.authorizations.all,
    });
  });
});
