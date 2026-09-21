import { describe, expect, it, vi } from "vitest";
import { SeriesService } from "../../apps/api/src/modules/series/application/services/series.service.js";

const context = {
  userId: "00000000-0000-4000-8000-000000000001",
  sessionId: "series-counts-session",
};

const emptySeries = {
  id: "00000000-0000-4000-8000-000000000010",
  title: "Empty",
  slug: "empty",
  description: null,
  coverUrl: null,
  discordChannelId: null,
  discordChannelNameSnapshot: null,
  responsibleUser: null,
  createdBy: context.userId,
  createdAt: new Date(),
  updatedAt: new Date(),
  chapterCount: 0,
  imageCount: 0,
};
const populatedSeries = {
  ...emptySeries,
  id: "00000000-0000-4000-8000-000000000011",
  title: "Populated",
  slug: "populated",
  chapterCount: 3,
  imageCount: 13,
};

function fixture(role: "admin" | "gestor" | "uploader") {
  const repository = {
    listAll: vi.fn().mockResolvedValue([emptySeries, populatedSeries]),
    listWithHelperAccess: vi.fn().mockResolvedValue([]),
  };
  const assignments = {
    listAssignedSeriesIds: vi.fn().mockResolvedValue([populatedSeries.id]),
    listResponsibleUsers: vi.fn().mockResolvedValue(new Map()),
  };
  const authorization = {
    authorize: vi.fn().mockResolvedValue({
      allowed: true,
      role,
    }),
  };
  return {
    repository,
    assignments,
    service: new SeriesService(
      repository as never,
      {} as never,
      authorization as never,
      assignments as never,
      {} as never,
      {} as never,
    ),
  };
}

describe("Series list read-model counts", () => {
  it("passes repository-projected zero and non-zero counts through unchanged", async () => {
    const target = fixture("gestor");

    await expect(target.service.list(context)).resolves.toEqual([
      expect.objectContaining({
        id: emptySeries.id,
        chapterCount: 0,
        imageCount: 0,
      }),
      expect.objectContaining({
        id: populatedSeries.id,
        chapterCount: 3,
        imageCount: 13,
      }),
    ]);
    expect(target.repository.listAll).toHaveBeenCalledOnce();
  });

  it("preserves uploader visibility filtering without recalculating counts", async () => {
    const target = fixture("uploader");

    await expect(target.service.list(context)).resolves.toEqual([
      expect.objectContaining({
        id: populatedSeries.id,
        chapterCount: 3,
        imageCount: 13,
      }),
    ]);
    expect(target.repository.listWithHelperAccess).toHaveBeenCalledWith(
      context.userId,
    );
  });
});
