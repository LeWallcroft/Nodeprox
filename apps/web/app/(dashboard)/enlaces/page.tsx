import { EmptyState } from "../../../components/ui/empty-state";
import { PageHeader } from "../../../components/layout/page-header";

export default function EnlacesPlaceholderPage() {
  return (
    <>
      <PageHeader
        title="Enlaces"
        description="Área reservada para una futura fase de dominio."
        breadcrumbs={[
          { label: "Dashboard", href: "/" },
          { label: "Enlaces", current: true },
        ]}
      />
      <EmptyState
        title="Enlaces aún no disponibles"
        description="M1 solo prepara la navegación y los componentes base."
      />
    </>
  );
}
