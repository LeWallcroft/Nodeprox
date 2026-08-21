import { EmptyState } from "../../../components/ui/empty-state";
import { PageHeader } from "../../../components/layout/page-header";

export default function SeriesPlaceholderPage() {
  return (
    <>
      <PageHeader
        title="Series"
        description="Área reservada para una futura fase de dominio."
        breadcrumbs={[
          { label: "Dashboard", href: "/" },
          { label: "Series", current: true },
        ]}
      />
      <EmptyState
        title="Series aún no disponibles"
        description="M1 solo valida el layout y la navegación."
      />
    </>
  );
}
