import { describe, expect, it } from "vitest";
import {
  fatalDiagnostic,
  sanitizeOperationalText,
} from "../../observability/sanitize-operational-text.js";

describe("operational diagnostic sanitization", () => {
  it("redacts credentials and signed URL content from fatal projections", () => {
    const diagnostic = fatalDiagnostic(
      new Error(
        "DATABASE_URL=secret-value token=secret-value authorization=Bearer-secret https://example.test/file?signature=secret",
      ),
    );

    expect(diagnostic.errorName).toBe("Error");
    expect(diagnostic.errorMessage).not.toContain("secret-value");
    expect(diagnostic.errorMessage).not.toContain("Bearer-secret");
    expect(diagnostic.errorMessage).not.toContain("example.test");
    expect(diagnostic.errorMessage).not.toContain("signature=secret");
    expect(diagnostic.errorMessage).toContain("DATABASE_URL=[REDACTED]");
  });

  it("bounds and sanitizes free-form operational text", () => {
    expect(
      sanitizeOperationalText("https://example.test/file?signature=secret"),
    ).toBe("[REDACTED_URL]");
    expect(
      fatalDiagnostic(new Error("x".repeat(600))).errorMessage,
    ).toHaveLength(512);
  });
});
