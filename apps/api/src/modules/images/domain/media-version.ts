export class InvalidMediaVersionError extends Error {
  constructor() {
    super("Media version must be a positive safe integer");
    this.name = "InvalidMediaVersionError";
  }
}

export class MediaVersion {
  private constructor(private readonly value: number) {}

  static initial(): MediaVersion {
    return new MediaVersion(1);
  }

  static parse(value: number): MediaVersion {
    if (!Number.isSafeInteger(value) || value <= 0)
      throw new InvalidMediaVersionError();
    return new MediaVersion(value);
  }

  next(): MediaVersion {
    return MediaVersion.parse(this.value + 1);
  }

  equals(other: MediaVersion): boolean {
    return this.value === other.value;
  }

  toNumber(): number {
    return this.value;
  }
}
