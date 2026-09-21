import { describe, expect, it } from "vitest";
import { filterSeries, toSeriesListItem } from "./view-model";

const series = [
  {
    id: "series-1",
    title: "Raven",
    slug: "raven",
    description: "Una serie",
    coverUrl: null,
    discordChannelId: null,
    discordChannelNameSnapshot: null,
    chapterCount: 0,
    imageCount: 0,
    responsibleUser: null,
    createdBy: "user-1",
    createdAt: "2026-08-01T00:00:00.000Z",
    updatedAt: "2026-08-02T00:00:00.000Z",
  },
  {
    id: "series-2",
    title: "Northwind",
    slug: "northwind",
    description: null,
    coverUrl: null,
    discordChannelId: null,
    discordChannelNameSnapshot: null,
    chapterCount: 4,
    imageCount: 72,
    responsibleUser: null,
    createdBy: "user-2",
    createdAt: "2026-08-01T00:00:00.000Z",
    updatedAt: "2026-08-03T00:00:00.000Z",
  },
];

describe("Series list view model", () => {
  it("keeps only fields supplied by the Series contract", () => {
    const first = series.at(0);
    if (!first) throw new Error("Expected a Series fixture");
    expect(toSeriesListItem(first)).toEqual({
      id: "series-1",
      title: "Raven",
      slug: "raven",
      description: "Una serie",
      coverUrl: null,
      chapterCount: 0,
      imageCount: 0,
      responsibleUser: null,
      updatedAt: "2026-08-02T00:00:00.000Z",
    });
  });

  it("filters real list data by title or public slug", () => {
    expect(filterSeries(series, "rav")).toHaveLength(1);
    expect(filterSeries(series, "NORTHWIND")).toHaveLength(1);
    expect(filterSeries(series, "missing")).toHaveLength(0);
  });

  it("preserves authoritative zero and non-zero aggregate counts", () => {
    const first = series.at(0);
    const second = series.at(1);
    if (!first || !second) throw new Error("Expected Series fixtures");

    expect(toSeriesListItem(first)).toMatchObject({
      chapterCount: 0,
      imageCount: 0,
    });
    expect(toSeriesListItem(second)).toMatchObject({
      chapterCount: 4,
      imageCount: 72,
    });
  });
});
