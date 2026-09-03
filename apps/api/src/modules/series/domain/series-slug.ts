const SERIES_SLUG_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

export class InvalidSeriesSlugError extends Error {
  constructor() {
    super("The Series title does not produce a valid canonical slug.");
    this.name = "InvalidSeriesSlugError";
  }
}

export class SeriesSlug {
  private constructor(private readonly value: string) {}

  static fromTitle(title: string): SeriesSlug {
    const value = title
      .trim()
      .normalize("NFKD")
      .replace(/\p{M}+/gu, "")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/-+/g, "-")
      .replace(/^-|-$/g, "");

    if (!value || value.length > 220 || !SERIES_SLUG_PATTERN.test(value)) {
      throw new InvalidSeriesSlugError();
    }

    return new SeriesSlug(value);
  }

  static parseExisting(value: string): SeriesSlug {
    if (!value || value.length > 220 || !SERIES_SLUG_PATTERN.test(value)) {
      throw new InvalidSeriesSlugError();
    }

    return new SeriesSlug(value);
  }

  equals(other: SeriesSlug): boolean {
    return this.value === other.value;
  }

  toString(): string {
    return this.value;
  }
}
