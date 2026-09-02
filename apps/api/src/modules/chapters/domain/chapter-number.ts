const SCALE = 1000;
const MAX_SCALED_VALUE = 9_999_999_999;

/** Exact, non-negative Chapter identity with at most three decimal places. */
export class ChapterNumber {
  private constructor(private readonly scaled: number) {}

  static parse(input: string | number): ChapterNumber {
    const raw = typeof input === "number" ? String(input) : input.trim();
    if (!/^(?:0|[1-9]\d*)(?:\.\d{1,3})?$/.test(raw))
      throw new ChapterNumberError();
    const [whole, fraction = ""] = raw.split(".");
    const scaled = Number(whole) * SCALE + Number(fraction.padEnd(3, "0"));
    if (
      !Number.isSafeInteger(scaled) ||
      scaled < 0 ||
      scaled > MAX_SCALED_VALUE
    )
      throw new ChapterNumberError();
    return new ChapterNumber(scaled);
  }

  static isValid(input: unknown): input is string | number {
    try {
      if (typeof input !== "string" && typeof input !== "number") return false;
      ChapterNumber.parse(input);
      return true;
    } catch {
      return false;
    }
  }

  equals(other: ChapterNumber): boolean {
    return this.scaled === other.scaled;
  }

  compareTo(other: ChapterNumber): number {
    return this.scaled - other.scaled;
  }

  toCanonicalString(): string {
    const whole = Math.floor(this.scaled / SCALE);
    const fraction = String(this.scaled % SCALE)
      .padStart(3, "0")
      .replace(/0+$/, "");
    return fraction ? `${whole}.${fraction}` : String(whole);
  }

  toPublicKey(): string {
    return this.toCanonicalString().replace(".", "-");
  }

  toNumber(): number {
    return Number(this.toCanonicalString());
  }
}

export class ChapterNumberError extends Error {
  constructor() {
    super("chapter-number-invalid");
  }
}
