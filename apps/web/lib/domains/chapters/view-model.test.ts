import { describe, expect, it } from "vitest";
import { filterChapters, sortChapters, toChapterListItem } from "./view-model";

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
    });
  });

  it("filters only local, already-authorized Chapter data", () => {
    expect(filterChapters(chapters, "25")).toHaveLength(1);
    expect(filterChapters(chapters, "inicio")).toHaveLength(1);
    expect(filterChapters(chapters, "missing")).toHaveLength(0);
  });
});
