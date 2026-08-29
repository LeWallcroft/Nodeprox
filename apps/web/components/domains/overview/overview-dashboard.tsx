import Link from "next/link";
import {
  AlertTriangle,
  CheckCircle2,
  CircleHelp,
  FileText,
  Images,
  Layers3,
  Users,
} from "lucide-react";
import { Card } from "../../ui/card";
import { hasCapability } from "../../../lib/auth/visibility";
import type { OverviewReadModel } from "../../../lib/domains/overview/types";
import {
  formatActivityDate,
  formatBytes,
  getActivityPresentation,
} from "./activity-presentation";
import { OverviewActivityChart } from "./overview-activity-chart";

type Kpi = {
  label: string;
  value: number | null;
  icon: typeof Layers3;
};

export function OverviewDashboard({
  overview,
  capabilities,
}: {
  overview: OverviewReadModel;
  capabilities: readonly string[];
}) {
  const kpis: Kpi[] = [
    { label: "Series totales", value: overview.totals.series, icon: Layers3 },
    { label: "Capítulos totales", value: overview.totals.chapters, icon: FileText },
    { label: "Imágenes totales", value: overview.totals.images, icon: Images },
    { label: "Usuarios activos", value: overview.totals.activeUsers, icon: Users },
  ];
  const canViewAudit = hasCapability(capabilities, "admin.system.manage");
  const status = {
    operational: { label: "Operativo", icon: CheckCircle2, tone: "text-success" },
    degraded: { label: "Degradado", icon: AlertTriangle, tone: "text-warning" },
    unknown: { label: "Estado desconocido", icon: CircleHelp, tone: "text-muted" },
  }[overview.system.overallStatus];
  const StatusIcon = status.icon;
  const hasStorage = overview.system.storage.usedBytes !== null;

  return (
    <div className="grid gap-section">
      <section className="grid gap-card sm:grid-cols-2 xl:grid-cols-4" aria-label="Indicadores principales">
        {kpis.map((kpi) => {
          const Icon = kpi.icon;
          const restricted = kpi.value === null;
          return (
            <Card key={kpi.label} className="flex min-h-32 items-start justify-between gap-4 p-5">
              <div>
                <p className="m-0 text-sm text-secondary">{kpi.label}</p>
                <p className="mt-3 text-3xl font-semibold tracking-tight" title={restricted ? "No disponible para tu cuenta" : undefined}>
                  {restricted ? "—" : kpi.value}
                </p>
                {restricted ? <p className="m-0 text-xs text-muted">No disponible para tu cuenta</p> : null}
              </div>
              <span className="grid size-10 shrink-0 place-items-center rounded-control bg-primary-soft text-primary" aria-hidden="true">
                <Icon className="size-5" />
              </span>
            </Card>
          );
        })}
      </section>

      <section className="grid gap-card xl:grid-cols-[minmax(0,2fr)_minmax(0,3fr)]">
        <Card className="min-w-0 p-0" aria-labelledby="recent-activity-title">
          <div className="flex items-center justify-between gap-3 border-b border-border px-5 py-4">
            <h3 id="recent-activity-title" className="m-0 text-base font-semibold">Actividad reciente</h3>
            {canViewAudit ? <Link className="text-sm font-medium text-primary hover:text-primary-hover" href="/admin/audit">Ver todo</Link> : null}
          </div>
          {overview.recentActivity.length ? (
            <ol className="m-0 list-none divide-y divide-border p-0">
              {overview.recentActivity.map((activity) => {
                const presentation = getActivityPresentation(activity.action, activity.resourceType);
                const Icon = presentation.icon;
                return (
                  <li key={activity.id} className="flex gap-3 px-5 py-4">
                    <span className="grid size-8 shrink-0 place-items-center rounded-control bg-primary-soft text-primary" aria-hidden="true"><Icon className="size-4" /></span>
                    <div className="min-w-0 flex-1">
                      <p className="m-0 text-sm font-medium text-text">{presentation.label}</p>
                      <p className="mt-1 truncate text-xs text-muted">{activity.actor.label}{activity.resourceLabel ? ` · ${activity.resourceLabel}` : ""}</p>
                    </div>
                    <time className="shrink-0 text-xs text-muted" dateTime={activity.occurredAt}>{formatActivityDate(activity.occurredAt)}</time>
                  </li>
                );
              })}
            </ol>
          ) : <p className="px-5 py-10 text-center text-sm text-muted">No hay actividad reciente.</p>}
        </Card>

        <Card className="min-w-0 p-5" aria-labelledby="system-status-title">
          <h3 id="system-status-title" className="m-0 text-base font-semibold">Estado del sistema</h3>
          <div className="mt-4 grid gap-card sm:grid-cols-2">
            <section className="rounded-control border border-border bg-surface-elevated p-4">
              <div className="flex items-center gap-2"><StatusIcon className={`size-4 ${status.tone}`} aria-hidden="true" /><h4 className="m-0 text-sm font-medium">Estado general</h4></div>
              <p className={`mb-0 mt-4 text-lg font-semibold ${status.tone}`}>{status.label}</p>
              <p className="mb-0 mt-1 text-xs text-muted">{overview.system.overallStatus === "operational" ? "Servicios de lectura del dashboard disponibles." : "Información limitada del estado del dashboard."}</p>
            </section>
            <section className="rounded-control border border-border bg-surface-elevated p-4">
              <h4 className="m-0 text-sm font-medium">Uso de almacenamiento</h4>
              {hasStorage ? <><p className="mb-0 mt-4 text-lg font-semibold">{formatBytes(overview.system.storage.usedBytes ?? 0)} almacenados</p><p className="mb-0 mt-1 text-xs text-muted">Métrica calculada desde imágenes persistidas.</p></> : <><p className="mb-0 mt-4 text-lg font-semibold">No disponible</p><p className="mb-0 mt-1 text-xs text-muted">Métrica de almacenamiento B2 no integrada.</p></>}
            </section>
          </div>
          <section className="mt-card rounded-control border border-border bg-surface-elevated p-4">
            <h4 className="m-0 text-sm font-medium">Actividad (últimos 7 días)</h4>
            <div className="mt-4"><OverviewActivityChart points={overview.system.activity7d} /></div>
          </section>
        </Card>
      </section>
    </div>
  );
}
