"use client";

import { useMemo, useState } from "react";
import { AuthorizationList } from "../../../components/domains/authorizations/authorization-list";
import { errorMessage } from "../../../components/domains/feedback";
import { SeriesForm } from "../../../components/domains/series/series-form";
import { PageHeader } from "../../../components/layout/page-header";
import { AppDialog } from "../../../components/ui/app-dialog";
import { Button } from "../../../components/ui/button";
import { EmptyState } from "../../../components/ui/empty-state";
import { ErrorState } from "../../../components/ui/error-state";
import { LoadingState } from "../../../components/ui/loading-state";
import { hasCapability } from "../../../lib/auth/visibility";
import { useCapabilities } from "../../../lib/domains/auth/hooks";
import {
  useAdminSeriesCreationGrants,
  useMySeriesCreationGrants,
} from "../../../lib/domains/authorizations/hooks";
import type {
  SeriesCreationGrantListItem,
  SeriesCreationGrantStatus,
} from "../../../lib/domains/authorizations/types";
import { useCreateSeries } from "../../../lib/domains/series/hooks";
import type { SeriesInput } from "../../../lib/domains/series/types";

const filters: Array<{ label: string; value?: SeriesCreationGrantStatus }> = [
  { label: "Todas" },
  { label: "Disponibles", value: "available" },
  { label: "Consumidas", value: "consumed" },
  { label: "Invalidas", value: "invalidated" },
];

export default function AuthorizationsPage() {
  const capabilities = useCapabilities();
  const [status, setStatus] = useState<SeriesCreationGrantStatus>();
  const [scope, setScope] = useState<"mine" | "all">("mine");
  const [grantToUse, setGrantToUse] =
    useState<SeriesCreationGrantListItem | null>(null);
  const createSeries = useCreateSeries();
  const canReadAll = hasCapability(
    capabilities.data?.capabilities,
    "discord.series-grant.read",
  );
  const mineQuery = useMySeriesCreationGrants(status, scope === "mine");
  const allQuery = useAdminSeriesCreationGrants(
    status,
    scope === "all" && canReadAll,
  );
  const grantsQuery = scope === "all" ? allQuery : mineQuery;
  const grants =
    scope === "all" ? (allQuery.data?.items ?? []) : (mineQuery.data ?? []);
  const hasAvailable = useMemo(
    () => grants.some((grant) => grant.status === "available"),
    [grants],
  );
  const applicableGrants = useMemo(
    () =>
      (mineQuery.data ?? []).filter(
        (grant) => grant.status === "available" && grant.applicable,
      ),
    [mineQuery.data],
  );

  async function createFromAuthorization(input: SeriesInput) {
    await createSeries.mutateAsync(input);
    setGrantToUse(null);
  }

  return (
    <>
      <PageHeader
        title="Autorizaciones"
        description="Consulta las autorizaciones disponibles y el historial para crear Series."
        breadcrumbs={[
          { label: "Dashboard", href: "/" },
          { label: "Autorizaciones", current: true },
        ]}
      />
      {canReadAll ? (
        <div
          className="mb-4 flex gap-2"
          role="tablist"
          aria-label="Alcance de autorizaciones"
        >
          <Button
            aria-selected={scope === "mine"}
            role="tab"
            type="button"
            variant={scope === "mine" ? "primary" : "secondary"}
            onClick={() => setScope("mine")}
          >
            Mis autorizaciones
          </Button>
          <Button
            aria-selected={scope === "all"}
            role="tab"
            type="button"
            variant={scope === "all" ? "primary" : "secondary"}
            onClick={() => setScope("all")}
          >
            Todas
          </Button>
        </div>
      ) : null}
      <fieldset className="mb-4 flex flex-wrap gap-2">
        <legend className="sr-only">Filtrar autorizaciones</legend>
        {filters.map((filter) => (
          <Button
            aria-pressed={status === filter.value}
            key={filter.label}
            type="button"
            variant={status === filter.value ? "primary" : "secondary"}
            onClick={() => setStatus(filter.value)}
          >
            {filter.label}
          </Button>
        ))}
      </fieldset>
      {grantsQuery.isPending ? (
        <LoadingState label="Cargando autorizaciones" />
      ) : null}
      {grantsQuery.isError ? (
        <ErrorState
          title="No se pudieron cargar las autorizaciones"
          description={errorMessage(grantsQuery.error)}
          action={
            <Button type="button" onClick={() => void grantsQuery.refetch()}>
              Reintentar
            </Button>
          }
        />
      ) : null}
      {grantsQuery.isSuccess && grants.length === 0 ? (
        <EmptyState
          title={
            status === "available"
              ? scope === "all"
                ? "No hay autorizaciones disponibles."
                : "No tienes autorizaciones disponibles."
              : "No se encontraron autorizaciones."
          }
          description={
            status === "available"
              ? "Solicita una autorización desde Discord para poder crear una Serie."
              : "No hay autorizaciones que coincidan con este filtro."
          }
        />
      ) : null}
      {grantsQuery.isSuccess && grants.length > 0 ? (
        scope === "mine" ? (
          <AuthorizationList
            grants={grants}
            onUse={(grant) => setGrantToUse(grant)}
          />
        ) : (
          <AuthorizationList grants={grants} />
        )
      ) : null}
      {grantsQuery.isSuccess && !hasAvailable && status === undefined ? (
        <p className="mt-4 text-sm text-muted">
          Solicita una autorización desde Discord para poder crear una Serie.
        </p>
      ) : null}
      <AppDialog
        open={Boolean(grantToUse)}
        title="Nueva serie"
        onOpenChange={(open) => {
          if (!open) setGrantToUse(null);
        }}
      >
        {grantToUse ? (
          <SeriesForm
            key={grantToUse.id}
            availableGrants={applicableGrants}
            initial={{ grantId: grantToUse.id }}
            onCancel={() => setGrantToUse(null)}
            onSubmit={createFromAuthorization}
            requiresGrant
          />
        ) : null}
      </AppDialog>
    </>
  );
}
