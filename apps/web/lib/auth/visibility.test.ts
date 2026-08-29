import { describe, expect, it } from "vitest";
import { hasCapability } from "./visibility";

describe("frontend authorization visibility", () => {
  it("uses server-projected contextual capabilities", () => {
    const ownerCapabilities = ["series.read", "series.edit", "chapters.create"];
    expect(hasCapability(ownerCapabilities, "series.edit")).toBe(true);
    expect(hasCapability(ownerCapabilities, "series.delete")).toBe(false);
  });

  it("does not infer helper access from the global uploader role", () => {
    const uploaderCapabilities = ["series.read"];
    expect(hasCapability(uploaderCapabilities, "images.upload")).toBe(false);
    expect(hasCapability(uploaderCapabilities, "chapters.edit")).toBe(false);
    expect(
      hasCapability(["chapters.read", "images.upload"], "images.upload"),
    ).toBe(true);
  });
});
