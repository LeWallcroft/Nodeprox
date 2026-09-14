import { describe, expect, it } from "vitest";
import { queryKeys } from "../query-keys";
import { grantOptionLabel } from "./view-model";

describe("Series creation grant view model", () => {
  it("uses a readable code and reference label without using the display code as authority", () => {
    expect(
      grantOptionLabel({
        id: "c56aef0e-da3d-42fc-8548-8eadcda8bdce",
        displayCode: "NPX-SER-TEST",
        reference: "Manga semanal",
        status: "available",
        issuedAt: "2026-09-11T12:00:00.000Z",
      }),
    ).toBe("NPX-SER-TEST — Manga semanal");
  });
});

describe("Authorization query keys", () => {
  it("keeps own and administrative grant data in separate caches", () => {
    expect(queryKeys.authorizations.mine()).not.toEqual(
      queryKeys.authorizations.admin(),
    );
  });
});
