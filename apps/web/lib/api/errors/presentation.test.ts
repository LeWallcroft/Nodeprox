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
});
