import { describe, expect, it } from "vitest";
import { ApiError, normalizeApiError } from "./types";

describe("API error normalization", () => {
  it("keeps the safe public error contract", () => {
    const error = normalizeApiError(422, {
      code: "VALIDATION_ERROR",
      message: "Datos inválidos",
    });
    expect(error).toBeInstanceOf(ApiError);
    expect(error.status).toBe(422);
    expect(error.code).toBe("VALIDATION_ERROR");
    expect(error.message).toBe("Datos inválidos");
  });

  it("uses a generic message for unknown payloads", () => {
    expect(normalizeApiError(503, { secret: "never expose" }).message).toBe(
      "API request failed (503)",
    );
  });
});
