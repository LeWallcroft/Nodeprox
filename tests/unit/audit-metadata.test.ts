import { describe, expect, it } from "vitest";
import {
  InvalidAuditMetadataError,
  sanitizeAuditMetadata,
} from "../../apps/api/src/modules/authorization/infrastructure/audit/audit-metadata.js";

describe("audit metadata boundary", () => {
  it("allows non-sensitive media version transitions", () => {
    expect(
      sanitizeAuditMetadata({ previousVersion: 1, currentVersion: 2 }),
    ).toEqual({ previousVersion: 1, currentVersion: 2 });
  });

  it("keeps the approved non-sensitive metadata only", () => {
    expect(
      sanitizeAuditMetadata({ requestId: "req-1", result: "denied" }),
    ).toEqual({ requestId: "req-1", result: "denied" });
  });

  it("allows bounded admission rejection summary metadata", () => {
    expect(
      sanitizeAuditMetadata({
        validationRunId: "run-1",
        issueCount: 2,
        issueCodes: ["ZIP_INVALID", "IMAGE_MAGIC_MISMATCH"],
      }),
    ).toEqual({
      validationRunId: "run-1",
      issueCount: 2,
      issueCodes: ["ZIP_INVALID", "IMAGE_MAGIC_MISMATCH"],
    });
  });

  it("rejects non-string issue codes and unapproved array metadata", () => {
    expect(() =>
      sanitizeAuditMetadata({ issueCodes: ["ZIP_INVALID", 4] }),
    ).toThrow(InvalidAuditMetadataError);
    expect(() => sanitizeAuditMetadata({ issueCount: ["1"] })).toThrow(
      InvalidAuditMetadataError,
    );
    expect(() => sanitizeAuditMetadata({ arbitrary: ["value"] })).toThrow(
      InvalidAuditMetadataError,
    );
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
