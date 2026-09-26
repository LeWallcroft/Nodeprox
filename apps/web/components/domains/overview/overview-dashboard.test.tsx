import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { Activity, Settings } from "lucide-react";
import type { OverviewReadModel } from "../../../lib/domains/overview/types";
import { formatBytes, getActivityPresentation } from "./activity-presentation";
import { OverviewActivityChart } from "./overview-activity-chart";
import { OverviewDashboard } from "./overview-dashboard";

const overview: OverviewReadModel = {
  totals: { series: 3, chapters: 8, images: 12, activeUsers: 2 },
  recentActivity: [
    {
      id: "activity-1",
      actor: { id: "user-1", label: "erick" },
      action: "settings.updated",
      resourceType: "product-settings",
      resourceLabel: null,
      occurredAt: "2026-08-29T10:42:00.000Z",
    },
  ],
  system: {
    overallStatus: "operational",
    storage: { usedBytes: 25_165_824, quotaBytes: null, source: "database" },
    activity7d: [
      { date: "2026-08-23", series: 0, chapters: 0 },
      { date: "2026-08-24", series: 1, chapters: 0 },
      { date: "2026-08-25", series: 0, chapters: 2 },
      { date: "2026-08-26", series: 0, chapters: 0 },
      { date: "2026-08-27", series: 1, chapters: 1 },
      { date: "2026-08-28", series: 0, chapters: 0 },
      { date: "2026-08-29", series: 1, chapters: 2 },
    ],
  },
};

describe("Overview dashboard presentation", () => {
  it("renders four real KPI cards and capability-aware audit navigation", () => {
    const markup = renderToStaticMarkup(
      <OverviewDashboard
        overview={overview}
        capabilities={["admin.system.manage"]}
      />,
    );

    expect(markup).toContain("Series totales");
    expect(markup).toContain("Capítulos totales");
    expect(markup).toContain("Imágenes totales");
    expect(markup).toContain("Usuarios activos");
    expect(markup).toContain(">3<");
    expect(markup).toContain('href="/admin/audit"');
  });

  it("keeps zero totals and restricted active users distinct", () => {
    const markup = renderToStaticMarkup(
      <OverviewDashboard
        overview={{
          ...overview,
          totals: { series: 0, chapters: 0, images: 0, activeUsers: null },
        }}
        capabilities={[]}
      />,
    );

    expect(markup).toContain("No disponible para tu cuenta");
    expect(markup).not.toContain('href="/admin/audit"');
    expect((markup.match(/>0</g) ?? []).length).toBeGreaterThanOrEqual(3);
  });

  it("renders human activity labels, contextual and fallback icons, and empty activity", () => {
    expect(
      getActivityPresentation("settings.updated", "product-settings"),
    ).toMatchObject({
      label: "Configuración actualizada",
      icon: Settings,
    });
    expect(getActivityPresentation("unknown", "unknown").icon).toBe(Activity);
    const markup = renderToStaticMarkup(
      <OverviewDashboard
        overview={{ ...overview, recentActivity: [] }}
        capabilities={[]}
      />,
    );
    expect(markup).toContain("No hay actividad reciente.");
  });

  it("formats storage without a fake quota and renders all seven chart points safely", () => {
    expect(formatBytes(0)).toBe("0 B");
    expect(formatBytes(832_512)).toBe("813 KB");
    expect(formatBytes(25_165_824)).toBe("24 MB");
    const markup = renderToStaticMarkup(
      <OverviewActivityChart points={overview.system.activity7d} />,
    );
    expect(markup).toContain("Series");
    expect(markup).toContain("Capítulos");
    expect(markup.match(/<circle/g) ?? []).toHaveLength(14);
    expect(markup).not.toContain("%");
  });

  it("renders degraded and unknown system states plus an all-zero chart", () => {
    const zeroPoints = overview.system.activity7d.map((point) => ({
      ...point,
      series: 0,
      chapters: 0,
    }));
    const degraded = renderToStaticMarkup(
      <OverviewDashboard
        overview={{
          ...overview,
          system: {
            ...overview.system,
            overallStatus: "degraded",
            storage: {
              usedBytes: null,
              quotaBytes: null,
              source: "unavailable",
            },
            activity7d: zeroPoints,
          },
        }}
        capabilities={[]}
      />,
    );
    const unknown = renderToStaticMarkup(
      <OverviewDashboard
        overview={{
          ...overview,
          system: { ...overview.system, overallStatus: "unknown" },
        }}
        capabilities={[]}
      />,
    );
    expect(degraded).toContain("Degradado");
    expect(degraded).toContain("No disponible");
    expect(degraded).toContain("Sin actividad en los últimos 7 días.");
    expect(unknown).toContain("Estado desconocido");
  });
});
