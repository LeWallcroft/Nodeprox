"use client";

import { errorMessage } from "../../../../components/domains/feedback";
import { SettingsWorkspace } from "../../../../components/domains/settings/settings-workspace";
import { PageHeader } from "../../../../components/layout/page-header";
import { Button } from "../../../../components/ui/button";
import { EmptyState } from "../../../../components/ui/empty-state";
import { ErrorState } from "../../../../components/ui/error-state";
import { LoadingState } from "../../../../components/ui/loading-state";
import {
  useProductSettings,
  useUpdateProductSettings,
} from "../../../../lib/domains/settings/hooks";

export default function SettingsPage() {
  const settings = useProductSettings();
  const update = useUpdateProductSettings();
  return (
    <>
      <PageHeader
        title="Configuración"
        description="Gestiona los ajustes operativos del producto."
        breadcrumbs={[
          { label: "Dashboard", href: "/" },
          { label: "Administración", href: "/admin" },
          { label: "Configuración", current: true },
        ]}
      />
      {settings.isPending ? (
        <LoadingState label="Cargando configuración" />
      ) : null}
      {settings.isError ? (
        <ErrorState
          title="No se pudo cargar la configuración"
          description={errorMessage(settings.error)}
          action={
            <Button onClick={() => void settings.refetch()}>Reintentar</Button>
          }
        />
      ) : null}
      {settings.data?.sections.length === 0 ? (
        <EmptyState
          title="No hay ajustes disponibles"
          description="No existen ajustes de producto disponibles para administrar."
        />
      ) : null}
      {settings.data ? (
        <SettingsWorkspace
          settings={settings.data}
          saving={update.isPending}
          saveError={update.isError ? errorMessage(update.error) : undefined}
          onSave={(changes) => update.mutateAsync(changes)}
        />
      ) : null}
    </>
  );
}
