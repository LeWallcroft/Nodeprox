import { EmptyState } from "../../../components/ui/empty-state";
import { PageHeader } from "../../../components/layout/page-header";

export default function CargasPlaceholderPage() {
  return (
    <>
      <PageHeader
        title="Cargas"
        description="Área reservada para una futura fase de procesamiento."
        breadcrumbs={[
          { label: "Dashboard", href: "/" },
          { label: "Cargas", current: true },
        ]}
      />
      <EmptyState
        title="Cargas aún no disponibles"
        description="Uploads y procesamiento están fuera del alcance de M1."
      />
    </>
  );
}
