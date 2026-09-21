import { readFileSync } from "node:fs";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { AuthorizationDetailPanel } from "./authorization-detail-panel";
import { AuthorizationList } from "./authorization-list";

const grants = [
  {
    id: "c56aef0e-da3d-42fc-8548-8eadcda8bdce",
    displayCode: "NPX-SER-AVAILABLE",
    reference: "Manga semanal",
    status: "available" as const,
    issuedAt: "2026-09-11T12:00:00.000Z",
    applicable: true,
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

  it("uses the shared combobox and grant UUID as the create-Series authority", () => {
    const source = readFileSync(
      "apps/web/components/domains/series/series-form.tsx",
      "utf8",
    );

    expect(source).toContain("<SearchableCombobox");
    expect(source).toContain("id: grant.id");
    expect(source).toContain("label: grantOptionLabel(grant)");
    expect(source).not.toContain("<Select");
    expect(source).not.toContain('value="NPX-SER-AVAILABLE"');
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

  it("only exposes Usar for available applicable own grants", () => {
    const markup = renderToStaticMarkup(
      <AuthorizationList
        grants={grants}
        onCopy={() => undefined}
        onSelect={() => undefined}
        onUse={() => undefined}
      />,
    );
    expect(markup).toContain("Usar");
    expect(markup).toContain("Usar autorización NPX-SER-AVAILABLE");
    expect(markup).not.toContain("Usar autorización NPX-SER-CONSUMED");
    const listSource = readFileSync(
      "apps/web/components/domains/authorizations/authorization-list.tsx",
      "utf8",
    );
    expect(listSource).toContain("Ver detalles");
    expect(listSource).toContain("Copiar código");
  });

  it("keeps an available but non-applicable grant visible without Usar", () => {
    const markup = renderToStaticMarkup(
      <AuthorizationList
        grants={[
          {
            id: "c56aef0e-da3d-42fc-8548-8eadcda8bdce",
            displayCode: "NPX-SER-AVAILABLE",
            reference: "Manga semanal",
            status: "available",
            issuedAt: "2026-09-11T12:00:00.000Z",
            applicable: false,
          },
        ]}
        onUse={() => undefined}
      />,
    );
    expect(markup).toContain("Disponible");
    expect(markup).not.toContain("Usar autorización");
  });

  it("keeps the administrative scope capability-gated and separate from status filters", () => {
    const page = readFileSync(
      "apps/web/app/(dashboard)/autorizaciones/page.tsx",
      "utf8",
    );

    expect(page).toContain('"discord.series-grant.read"');
    expect(page).toContain("{canReadAll ? (");
    expect(page).toContain("Mis autorizaciones");
    expect(page).toContain("Todas");
    expect(page).toContain("Disponibles");
    expect(page).toContain("Consumidas");
    expect(page).toContain("Inválidas");
    expect(page).toContain('id="authorization-status"');
    expect(page).toContain('id="authorization-user"');
    expect(page).toContain("SearchableCombobox");
  });

  it("uses the shared stable detail shell without exposing unavailable history", () => {
    const availableGrant = grants.find((grant) => grant.status === "available");
    if (!availableGrant) throw new Error("Expected an available grant fixture");
    const markup = renderToStaticMarkup(
      <AuthorizationDetailPanel
        grant={availableGrant}
        isOwnScope
        onClose={() => undefined}
        onUse={() => undefined}
      />,
    );

    expect(markup).toContain("Detalle de autorización");
    expect(markup).toContain("Copiar código");
    expect(markup).toContain("Usar autorización");
    expect(markup).not.toContain("targetUserId");
    expect(markup).not.toContain("issuedByDiscordId");
  });

  it("uses a confirmation step before reusing the existing SeriesForm", () => {
    const page = readFileSync(
      "apps/web/app/(dashboard)/autorizaciones/page.tsx",
      "utf8",
    );

    expect(page).toContain('useState<"confirm" | "series">');
    expect(page).toContain("Confirmar y continuar");
    expect(page).toContain("esta autorización se consumirá");
    expect(page).toContain("initial={{ grantId: grantToUse.id }}");
    expect(page).toContain("Nueva autorización");
    expect(page).toContain('"discord.series-grant.issue"');
  });

  it("uses the OLA 2B public Web contracts and keeps grant authority server-side", () => {
    const api = readFileSync(
      "apps/web/lib/domains/authorizations/api.ts",
      "utf8",
    );
    const hooks = readFileSync(
      "apps/web/lib/domains/authorizations/hooks.ts",
      "utf8",
    );
    const page = readFileSync(
      "apps/web/app/(dashboard)/autorizaciones/page.tsx",
      "utf8",
    );

    expect(api).toContain("/admin/users/lookup?");
    expect(api).toContain('"/admin/series-creation-grants"');
    expect(api).toContain("/invalidate");
    expect(api).toContain("/history");
    expect(api).not.toContain("issuedVia");
    expect(api).not.toContain("issuedByUserId");
    expect(hooks).toContain("useIssueSeriesCreationGrant");
    expect(hooks).toContain("useInvalidateSeriesCreationGrant");
    expect(page).toContain("useDebouncedAuthorizationValue");
    expect(page).toContain("setAdminCursors([undefined])");
    expect(page).toContain("targetUserId: targetUserId || undefined");
  });

  it("projects consumption, history, and destructive actions without raw internals", () => {
    const panel = readFileSync(
      "apps/web/components/domains/authorizations/authorization-detail-panel.tsx",
      "utf8",
    );
    const list = readFileSync(
      "apps/web/components/domains/authorizations/authorization-list.tsx",
      "utf8",
    );
    const history = readFileSync(
      "apps/web/components/domains/authorizations/authorization-history-dialog.tsx",
      "utf8",
    );

    expect(panel).toContain("Consumida en");
    expect(panel).toContain("Serie creada");
    expect(panel).toContain("Invalidar autorización");
    expect(list).toContain("Ver historial de uso");
    expect(list).toContain("destructive: true");
    expect(history).toContain("issued");
    expect(history).toContain("consumed");
    expect(history).toContain("invalidated");
    expect(history).not.toContain("outbox");
    expect(history).not.toContain("interactionId");
  });

  it("keeps authorization selection visual-only and workspace geometry stable", () => {
    const page = readFileSync(
      "apps/web/app/(dashboard)/autorizaciones/page.tsx",
      "utf8",
    );
    const list = readFileSync(
      "apps/web/components/domains/authorizations/authorization-list.tsx",
      "utf8",
    );

    expect(page).toContain("xl:grid-cols-[minmax(0,1fr)_minmax(380px,420px)]");
    expect(page).not.toContain('selectedGrantId ? "grid-cols');
    expect(list).toContain("h-[76px]");
    expect(list).toContain('selected ? "bg-primary-soft"');
    expect(list).not.toContain('selected ? "border-2"');
    expect(list).not.toContain("transition-all");
  });
});
