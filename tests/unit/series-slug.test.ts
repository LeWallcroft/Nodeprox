import { describe, expect, it } from "vitest";
import {
  InvalidSeriesSlugError,
  SeriesSlug,
} from "../../apps/api/src/modules/series/domain/series-slug.js";

describe("SeriesSlug", () => {
  it.each([
    ["Mi Serie", "mi-serie"],
    ["  Mi   Serie  ", "mi-serie"],
    ["Mi---Serie", "mi-serie"],
    ["Érase una vez", "erase-una-vez"],
    ["SERIE Ñ", "serie-n"],
    ["Café", "cafe"],
    ["Niño", "nino"],
    ["À la carte", "a-la-carte"],
    ["Hello / World", "hello-world"],
    ["foo_bar", "foo-bar"],
    ["foo.bar", "foo-bar"],
    ["foo---bar", "foo-bar"],
  ])("canonicalizes %j as %j", (title, expected) => {
    expect(SeriesSlug.fromTitle(title).toString()).toBe(expected);
  });

  it.each(["!!!", "日本語", "---", "   "])(
    "rejects %j when canonicalization is empty",
    (title) => {
      expect(() => SeriesSlug.fromTitle(title)).toThrow(InvalidSeriesSlugError);
    },
  );

  it("parses existing canonical slugs without rewriting them", () => {
    const slug = SeriesSlug.parseExisting("already-stable");
    expect(slug.toString()).toBe("already-stable");
    expect(slug.equals(SeriesSlug.parseExisting("already-stable"))).toBe(true);
    expect(() => SeriesSlug.parseExisting("Not Canonical")).toThrow(
      InvalidSeriesSlugError,
    );
  });
});
