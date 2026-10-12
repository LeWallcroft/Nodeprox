import { describe, expect, it } from "vitest";
import { ApiError } from "../types";
import { resolveErrorPresentation } from "./presentation";

describe("resolveErrorPresentation", () => {
  it("uses a friendly code-driven message for chapter conflicts", () => {
    const presentation = resolveErrorPresentation(
      new ApiError(409, "technical text", "chapter-conflict", {
        code: "chapter-conflict",
        requestId: "req-conflict",
      }),
    );
    expect(presentation).toMatchObject({
      presentation: "inline",
      severity: "warning",
      requestId: "req-conflict",
    });
    expect(presentation.message).not.toContain("technical text");
  });

  it.each([
    [
      "series-has-media",
      "No se puede eliminar la serie porque tiene imágenes, archivos subidos o historial de almacenamiento.",
    ],
    [
      "series-active-operation",
      "Espera a que terminen las cargas o reemplazos asociados e inténtalo nuevamente.",
    ],
    [
      "series-lifecycle-transition-invalid",
      "La serie ya no está activa o el motivo está incompleto.",
    ],
    [
      "resource-conflict",
      "El estado o el contenido relacionado cambió antes de completar la acción.",
    ],
  ] as const)("explains series deletion block %s", (code, expectedText) => {
    const presentation = resolveErrorPresentation(
      new ApiError(409, "technical text", code, { code }),
    );
    expect(presentation.message).toContain(expectedText);
  });

  it.each([
    ["series-slug-conflict", 409],
    ["series-slug-invalid", 422],
  ])("uses a friendly Series slug message for %s", (code, status) => {
    const presentation = resolveErrorPresentation(
      new ApiError(status, "technical text", code, {
        code,
        requestId: "req-series",
      }),
    );
    expect(presentation).toMatchObject({
      presentation: "inline",
      severity: "warning",
      requestId: "req-series",
    });
    expect(presentation.message).not.toContain("technical text");
  });

  it.each([
    "series-channel-required",
    "series-channel-invalid",
    "series-channel-validation-unavailable",
  ])("maps %s without exposing backend details", (code) => {
    const presentation = resolveErrorPresentation(
      new ApiError(422, "Discord REST error", code, { code }),
    );
    expect(presentation.presentation).toBe("inline");
    expect(presentation.message).not.toContain("REST");
  });

  it("does not expose internal details and retains the support reference", () => {
    const presentation = resolveErrorPresentation(
      new ApiError(500, "SQLSTATE leaked", "internal-error", {
        category: "internal",
        requestId: "req-internal",
      }),
    );
    expect(presentation.presentation).toBe("toast");
    expect(presentation.message).not.toContain("SQLSTATE");
    expect(presentation.requestId).toBe("req-internal");
  });
  it("does not expose unknown validation or business details", () => {
    for (const category of ["validation", "business_rule"] as const) {
      const presentation = resolveErrorPresentation(
        new ApiError(422, "private SQL text", "unknown", {
          category,
          detail: "private SQL text",
          requestId: "req-safe",
        }),
      );
      expect(presentation.message).not.toContain("private SQL text");
      expect(presentation.requestId).toBe("req-safe");
    }
  });
});
