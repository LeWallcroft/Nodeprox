import { describe, expect, it } from "vitest";
import {
  advanceCursorPageHistory,
  currentPageCursor,
  initialCursorPageHistory,
  retreatCursorPageHistory,
} from "./cursor-pagination.js";

describe("managed user cursor pagination", () => {
  it("keeps the cursor and page number synchronized while moving forward and back", () => {
    const page2 = advanceCursorPageHistory(
      initialCursorPageHistory,
      "cursor-1",
    );
    const page3 = advanceCursorPageHistory(page2, "cursor-2");

    expect(page3).toHaveLength(3);
    expect(currentPageCursor(page3)).toBe("cursor-2");

    const backToPage2 = retreatCursorPageHistory(page3);
    expect(backToPage2).toHaveLength(2);
    expect(currentPageCursor(backToPage2)).toBe("cursor-1");

    const forwardToPage3Again = advanceCursorPageHistory(
      backToPage2,
      "cursor-2",
    );
    expect(forwardToPage3Again).toEqual(page3);
  });

  it("does not duplicate a page if the same next action is applied twice", () => {
    const page2 = advanceCursorPageHistory(
      initialCursorPageHistory,
      "cursor-1",
    );
    expect(advanceCursorPageHistory(page2, "cursor-1")).toBe(page2);
  });

  it("does not move before the first page and resets to the first cursor", () => {
    expect(retreatCursorPageHistory(initialCursorPageHistory)).toBe(
      initialCursorPageHistory,
    );
    expect(currentPageCursor(initialCursorPageHistory)).toBeNull();
  });
});
