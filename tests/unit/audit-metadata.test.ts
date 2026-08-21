import { describe, expect, it } from "vitest";
import {
  InvalidAuditMetadataError,
  sanitizeAuditMetadata,
} from "../../apps/api/src/modules/authorization/infrastructure/audit/audit-metadata.js";

describe("audit metadata boundary", () => {
  it("keeps the approved non-sensitive metadata only", () => {
    expect(
      sanitizeAuditMetadata({ requestId: "req-1", result: "denied" }),
    ).toEqual({ requestId: "req-1", result: "denied" });
  });

  it.each([
    "password",
    "sessionToken",
    "nodeprox_session",
    "cookie",
    "authorizationHeader",
    "secret",
    "credential",
  ])("rejects sensitive metadata key %s", (key) => {
    expect(() => sanitizeAuditMetadata({ [key]: "sensitive" })).toThrow(
      InvalidAuditMetadataError,
    );
  });

  it("rejects unapproved nested or object metadata", () => {
    expect(() =>
      sanitizeAuditMetadata({ reason: { password: "secret" } }),
    ).toThrow(InvalidAuditMetadataError);
  });
});
