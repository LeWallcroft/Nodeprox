import { DiscordLinkSection } from "../../../../components/domains/discord/discord-link-section";
import { PageHeader } from "../../../../components/layout/page-header";
import { PageSection } from "../../../../components/ui/page-section";

export default function AccountIntegrationsPage() {
  return (
    <>
      <PageHeader
        title="Cuenta"
        description="Gestiona las integraciones vinculadas a tu cuenta."
        breadcrumbs={[
          { label: "Dashboard", href: "/" },
          { label: "Cuenta", current: true },
        ]}
      />
      <PageSection
        title="Integraciones"
        description="Conecta servicios externos de forma segura."
      >
        <DiscordLinkSection />
      </PageSection>
    </>
  );
}
