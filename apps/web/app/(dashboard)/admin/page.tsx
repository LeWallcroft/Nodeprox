import { EmptyState } from "../../../components/ui/empty-state";
import { PageHeader } from "../../../components/layout/page-header";

export default function AdminPlaceholderPage() {
  return (
    <>
      <PageHeader
        title="Administración"
        description="Placeholder visual sin autorización funcional."
        breadcrumbs={[
          { label: "Dashboard", href: "/" },
          { label: "Administración", current: true },
        ]}
      />
      <EmptyState
        title="Administración aún no disponible"
        description="RBAC y permisos están fuera del alcance de M1."
      />
    </>
  );
}
