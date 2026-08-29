import { EmptyState } from "../../../components/ui/empty-state";
import { PageHeader } from "../../../components/layout/page-header";

export default function AdminPlaceholderPage() {
  return (
    <>
      <PageHeader
        title="Administración"
        description="Las operaciones administrativas permanecen protegidas por el backend."
        breadcrumbs={[
          { label: "Dashboard", href: "/" },
          { label: "Administración", current: true },
        ]}
      />
      <EmptyState
        title="Administración aún no disponible"
        description="No tienes operaciones administrativas disponibles en esta vista."
      />
    </>
  );
}
