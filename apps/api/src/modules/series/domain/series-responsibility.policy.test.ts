import { describe, expect, it } from "vitest";
import { canBeSeriesResponsible } from "./series-responsibility.policy.js";

describe("Series responsibility candidate policy", () => {
  it.each(["admin", "gestor", "uploader"])(
    "allows an active %s as responsible",
    (role) => {
      expect(canBeSeriesResponsible({ status: "active", role })).toBe(true);
    },
  );

  it("rejects inactive and unsupported users", () => {
    expect(canBeSeriesResponsible({ status: "disabled", role: "admin" })).toBe(
      false,
    );
    expect(canBeSeriesResponsible({ status: "active", role: "reader" })).toBe(
      false,
    );
  });
});
