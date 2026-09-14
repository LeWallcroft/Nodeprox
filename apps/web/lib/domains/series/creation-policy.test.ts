import { describe, expect, it } from "vitest";
import { requiresSeriesCreationGrant } from "./creation-policy";

describe("Series creation grant UI policy", () => {
  it("requires a grant for uploader authority only", () => {
    expect(requiresSeriesCreationGrant(["series.create.with-grant"])).toBe(
      true,
    );
  });

  it("does not require a grant when normal Series creation is available", () => {
    expect(
      requiresSeriesCreationGrant([
        "series.create",
        "series.create.with-grant",
      ]),
    ).toBe(false);
  });

  it("does not grant creation to actors without either authority", () => {
    expect(requiresSeriesCreationGrant(["series.read"])).toBe(false);
  });
});
