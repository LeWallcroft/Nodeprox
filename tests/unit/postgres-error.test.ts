import { describe, expect, it } from "vitest";
import {
  findPostgresFailure,
  isPostgresCode,
  isUniqueConstraint,
} from "../../database/postgres-error.js";

describe("Postgres failure inspector", () => {
  it("finds SQLSTATE and exact constraints through nested causes", () => {
    const failure = {
      cause: {
        cause: { code: "23505", constraint_name: "users_email_unique" },
      },
    };
    expect(findPostgresFailure(failure)).toEqual({
      code: "23505",
      constraint: "users_email_unique",
    });
    expect(isUniqueConstraint(failure, ["users_email_unique"])).toBe(true);
    expect(isUniqueConstraint(failure, ["series_slug_unique"])).toBe(false);
  });

  it("bounds traversal and detects transaction failures by code", () => {
    const nested = { cause: { code: "40001" } };
    expect(findPostgresFailure(nested, 0)).toBeNull();
    expect(isPostgresCode(nested, "40001", "40P01")).toBe(true);
    const cyclic: { cause?: unknown } = {};
    cyclic.cause = cyclic;
    expect(findPostgresFailure(cyclic)).toBeNull();
  });
});
