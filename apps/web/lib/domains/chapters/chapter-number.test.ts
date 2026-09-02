import { describe, expect, it } from "vitest";
import { normalizeChapterNumber, parseChapterNumber } from "./chapter-number";

describe("Chapter number presentation", () => {
  it("canonicalizes supported non-negative decimal values", () => {
    expect(normalizeChapterNumber("0.000")).toBe("0");
    expect(normalizeChapterNumber("1.500")).toBe("1.5");
    expect(parseChapterNumber("25.125")).toBe(25.125);
  });

  it.each(["-1", "-0.1", "1.2345", "", "1e-3"])("rejects %s", (value) =>
    expect(parseChapterNumber(value)).toBeNull(),
  );
});
