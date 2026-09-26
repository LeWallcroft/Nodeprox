"use client";

import { PageHeader } from "../../components/layout/page-header";
import { OverviewDashboard } from "../../components/domains/overview/overview-dashboard";
import { ErrorState } from "../../components/ui/error-state";
import { LoadingState } from "../../components/ui/loading-state";
import { useCapabilities } from "../../lib/domains/auth/hooks";
import { useOverview } from "../../lib/domains/overview/hooks";

export default function DashboardPage() {
  const overview = useOverview();
  const capabilities = useCapabilities();
  return (
    <>
      <PageHeader
        title="Overview"
        description="Vista general de la plataforma."
        breadcrumbs={[{ label: "Dashboard", current: true }]}
      />
      {overview.isPending ? <LoadingState label="Cargando overview" /> : null}
      {overview.isError ? (
        <ErrorState
          title="No se pudo cargar el overview"
          description="Inténtalo nuevamente cuando el servicio esté disponible."
        />
      ) : null}
      {overview.data ? (
        <OverviewDashboard
          overview={overview.data}
          capabilities={capabilities.data?.capabilities ?? []}
        />
      ) : null}
    </>
  );
}
