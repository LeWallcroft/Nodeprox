import { describe, expect, it } from "vitest";
import {
  ChapterNumber,
  ChapterNumberError,
} from "../../apps/api/src/modules/chapters/domain/chapter-number.js";

describe("ChapterNumber", () => {
  it.each([
    ["0", "0"],
    ["0.000", "0"],
    ["0.1", "0.1"],
    ["0.5", "0.5"],
    ["1.000", "1"],
    ["1.500", "1.5"],
    ["25.125", "25.125"],
  ])("canonicalizes %s as %s", (input, expected) => {
    expect(ChapterNumber.parse(input).toCanonicalString()).toBe(expected);
  });

  it.each(["-0.1", "-1", "1.2345", "", "Infinity", "NaN"])(
    "rejects %s",
    (input) =>
      expect(() => ChapterNumber.parse(input)).toThrow(ChapterNumberError),
  );

  it("compares numeric values instead of strings", () => {
    const values = ["0", "0.1", "0.5", "1", "1.5", "2.1", "25.125"].map(
      ChapterNumber.parse,
    );
    expect(
      values
        .toSorted((left, right) => left.compareTo(right))
        .map((value) => value.toCanonicalString()),
    ).toEqual(["0", "0.1", "0.5", "1", "1.5", "2.1", "25.125"]);
    expect(
      ChapterNumber.parse("1.5").equals(ChapterNumber.parse("1.500")),
    ).toBe(true);
    expect(ChapterNumber.parse("25.125").toPublicKey()).toBe("25-125");
    expect(
      ["1.5", "15", "1.05", "1.050"].map((value) =>
        ChapterNumber.parse(value).toPublicKey(),
      ),
    ).toEqual(["1-5", "15", "1-05", "1-05"]);
  });
});
