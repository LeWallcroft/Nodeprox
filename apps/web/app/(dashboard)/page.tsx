import { EmptyState } from "../../components/ui/empty-state";
import { MetricCard } from "../../components/ui/metric-card";
import { PageHeader } from "../../components/layout/page-header";
import { PageToolbar } from "../../components/ui/page-toolbar";
import { StatusBadge } from "../../components/ui/status-badge";

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
        <button className="button button-secondary" type="button">
          Exportar
        </button>
      </PageToolbar>
      <section className="metrics-grid" aria-label="Métricas principales">
        <MetricCard
          label="Series"
          value="—"
          detail="Preparado para el dominio"
        />
        <MetricCard label="Cargas" value="—" detail="Sin procesamiento en M1" />
        <MetricCard label="Enlaces" value="—" detail="Sin datos todavía" />
        <MetricCard label="Estado" value="OK" detail="App Shell activo" />
      </section>
      <EmptyState
        title="Tu workspace está listo"
        description="M1 prepara la navegación y el sistema visual para las siguientes fases de NodeProx."
      />
    </>
  );
}
