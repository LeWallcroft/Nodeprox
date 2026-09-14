import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { SeriesForm } from "../series/series-form";
import { AuthorizationList } from "./authorization-list";

const grants = [
  {
    id: "c56aef0e-da3d-42fc-8548-8eadcda8bdce",
    displayCode: "NPX-SER-AVAILABLE",
    reference: "Manga semanal",
    status: "available" as const,
    issuedAt: "2026-09-11T12:00:00.000Z",
  },
  {
    id: "b95822d0-4a53-4fab-92b2-d04f7a594d6f",
    displayCode: "NPX-SER-CONSUMED",
    reference: null,
    status: "consumed" as const,
    issuedAt: "2026-09-10T12:00:00.000Z",
  },
  {
    id: "420642fd-6e69-4e8c-a0ce-9c6c2c211dea",
    displayCode: "NPX-SER-INVALID",
    reference: null,
    status: "invalidated" as const,
    issuedAt: "2026-09-09T12:00:00.000Z",
  },
];

describe("Series creation authorizations presentation", () => {
  it("renders supported grant states without sensitive internal fields", () => {
    const markup = renderToStaticMarkup(<AuthorizationList grants={grants} />);

    expect(markup).toContain("Disponible");
    expect(markup).toContain("Consumida");
    expect(markup).toContain("Invalidada");
    expect(markup).toContain("Manga semanal");
    expect(markup).toContain("Sin referencia");
    expect(markup).not.toContain("targetUserId");
    expect(markup).not.toContain("issuedByDiscordId");
  });

  it("uses the grant UUID as the create-Series selector value", () => {
    const markup = renderToStaticMarkup(
      <SeriesForm
        availableGrants={grants}
        requiresGrant
        onSubmit={async () => undefined}
      />,
    );

    expect(markup).toContain('value="c56aef0e-da3d-42fc-8548-8eadcda8bdce"');
    expect(markup).toContain("NPX-SER-AVAILABLE — Manga semanal");
    expect(markup).not.toContain('value="NPX-SER-AVAILABLE"');
    expect(markup).toContain("required");
  });

  it("shows the target only for the administrative grant projection", () => {
    const markup = renderToStaticMarkup(
      <AuthorizationList
        grants={[
          {
            id: "c56aef0e-da3d-42fc-8548-8eadcda8bdce",
            displayCode: "NPX-SER-AVAILABLE",
            reference: "Manga semanal",
            status: "available",
            issuedAt: "2026-09-11T12:00:00.000Z",
            targetUser: { id: "user-1", displayName: "uploader@example.com" },
          },
        ]}
      />,
    );

    expect(markup).toContain("Usuario");
    expect(markup).toContain("uploader@example.com");
    expect(markup).not.toContain("targetUserId");
  });
});
