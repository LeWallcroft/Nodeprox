import { describe, expect, it } from "vitest";
import {
  filterChapters,
  latestChapterNumber,
  latestChapterNumbersBySeries,
  sortChapters,
  toChapterListItem,
} from "./view-model";

const chapters = [
  {
    id: "chapter-30",
    seriesId: "series-1",
    chapterNumber: 30,
    publicKey: "30",
    title: "Final",
    status: "ready" as const,
    createdBy: "user-1",
    createdAt: "2026-08-01T00:00:00.000Z",
    updatedAt: "2026-08-03T00:00:00.000Z",
  },
  {
    id: "chapter-25",
    seriesId: "series-1",
    chapterNumber: 25,
    publicKey: "25",
    title: "Inicio",
    status: "draft" as const,
    createdBy: "user-1",
    createdAt: "2026-08-01T00:00:00.000Z",
    updatedAt: "2026-08-02T00:00:00.000Z",
  },
];

describe("Chapter list view model", () => {
  it("uses descending numeric order for scoped Chapter operations", () => {
    expect(
      sortChapters(chapters).map((chapter) => chapter.chapterNumber),
    ).toEqual([30, 25]);
  });

  it("keeps only fields present in the Chapter contract", () => {
    const first = chapters.at(0);
    if (!first) throw new Error("Expected a Chapter fixture");
    expect(toChapterListItem(first)).toEqual({
      id: "chapter-30",
      chapterNumber: 30,
      publicKey: "30",
      title: "Final",
      status: "ready",
      updatedAt: "2026-08-03T00:00:00.000Z",
      imageCount: 0,
    });
  });

  it("filters only local, already-authorized Chapter data", () => {
    expect(filterChapters(chapters, "25")).toHaveLength(1);
    expect(filterChapters(chapters, "inicio")).toHaveLength(1);
    expect(filterChapters(chapters, "missing")).toHaveLength(0);
  });

  it("finds the latest numeric Chapter without assuming list order", () => {
    expect(latestChapterNumber([])).toBeNull();
    expect(
      latestChapterNumber([
        { chapterNumber: 10 },
        { chapterNumber: 9.5 },
        { chapterNumber: 12 },
        { chapterNumber: 11.25 },
      ]),
    ).toBe(12);
    expect(
      latestChapterNumber([
        { chapterNumber: 10 },
        { chapterNumber: 10.25 },
        { chapterNumber: 10.5 },
      ]),
    ).toBe(10.5);
  });

  it("groups latest Chapter numbers from either supported Series projection", () => {
    expect(
      latestChapterNumbersBySeries([
        { seriesId: "one", chapterNumber: 10.5 },
        { seriesId: "one", chapterNumber: 9 },
        { series: { id: "two" }, chapterNumber: 3 },
      ]),
    ).toEqual({ one: 10.5, two: 3 });
  });
});
