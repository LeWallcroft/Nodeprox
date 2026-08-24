import { EmptyState } from "../../components/ui/empty-state";
import { MetricCard } from "../../components/ui/metric-card";
import { PageHeader } from "../../components/layout/page-header";
import { PageToolbar } from "../../components/ui/page-toolbar";
import { StatusBadge } from "../../components/ui/status-badge";
import { ApiStatusCard } from "../../components/ui/api-status-card";

export default function DashboardPage() {
  return (
    <>
      <PageHeader
        title="Overview"
        description="Una vista general de las operaciones de NodeProx."
        breadcrumbs={[{ label: "Dashboard", current: true }]}
        actions={<StatusBadge label="Sistema operativo" tone="success" />}
      />
      <PageToolbar>
        <button
          className="inline-flex min-h-control items-center justify-center rounded-lg border border-border bg-surface px-3.5 font-semibold text-text focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary"
          type="button"
        >
          Exportar
        </button>
      </PageToolbar>
      <section
        className="mb-section grid grid-cols-4 gap-card max-[900px]:grid-cols-2 max-[640px]:grid-cols-1"
        aria-label="Métricas principales"
      >
        <MetricCard
          label="Series"
          value="—"
          detail="Preparado para el dominio"
        />
        <MetricCard label="Cargas" value="—" detail="Sin procesamiento en M1" />
        <MetricCard label="Enlaces" value="—" detail="Sin datos todavía" />
        <MetricCard label="Estado" value="OK" detail="App Shell activo" />
      </section>
      <ApiStatusCard />
      <EmptyState
        title="Tu workspace está listo"
        description="M1 prepara la navegación y el sistema visual para las siguientes fases de NodeProx."
      />
    </>
  );
}
