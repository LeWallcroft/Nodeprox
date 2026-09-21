"use client";

import { Info, Plus } from "lucide-react";
import { useMemo, useState } from "react";
import { AuthorizationDetailPanel } from "../../../components/domains/authorizations/authorization-detail-panel";
import { AuthorizationHistoryDialog } from "../../../components/domains/authorizations/authorization-history-dialog";
import { AuthorizationIssueDialog } from "../../../components/domains/authorizations/authorization-issue-dialog";
import { AuthorizationList } from "../../../components/domains/authorizations/authorization-list";
import { errorMessage } from "../../../components/domains/feedback";
import { SeriesForm } from "../../../components/domains/series/series-form";
import { PageHeader } from "../../../components/layout/page-header";
import { AppDialog } from "../../../components/ui/app-dialog";
import { Button } from "../../../components/ui/button";
import { EmptyState } from "../../../components/ui/empty-state";
import { ErrorState } from "../../../components/ui/error-state";
import { LoadingState } from "../../../components/ui/loading-state";
import { Pagination } from "../../../components/ui/pagination";
import { SearchInput } from "../../../components/ui/search-input";
import { SearchableCombobox } from "../../../components/ui/searchable-combobox";
import { StatusBadge } from "../../../components/ui/status-badge";
import { hasCapability } from "../../../lib/auth/visibility";
import { useCapabilities } from "../../../lib/domains/auth/hooks";
import {
  useAdminSeriesCreationGrants,
  useAdminUserLookup,
  useDebouncedAuthorizationValue,
  useInvalidateSeriesCreationGrant,
  useMySeriesCreationGrants,
} from "../../../lib/domains/authorizations/hooks";
import type {
  AdminSeriesCreationGrantListItem,
  SeriesCreationGrantListItem,
  SeriesCreationGrantStatus,
} from "../../../lib/domains/authorizations/types";
import {
  authorizationStatusLabel,
  authorizationStatusTone,
} from "../../../lib/domains/authorizations/view-model";
import { useCreateSeries } from "../../../lib/domains/series/hooks";
import type { SeriesInput } from "../../../lib/domains/series/types";

const statusTabs: Array<{
  label: string;
  value?: SeriesCreationGrantStatus;
}> = [
  { label: "Todas" },
  { label: "Disponibles", value: "available" },
  { label: "Consumidas", value: "consumed" },
  { label: "Inválidas", value: "invalidated" },
];

const statusOptions = [
  { id: "", label: "Todos los estados" },
  { id: "available", label: "Disponible" },
  { id: "consumed", label: "Consumida" },
  { id: "invalidated", label: "Invalidada" },
];
const ownPageSize = 10;

export default function AuthorizationsPage() {
  const capabilities = useCapabilities();
  const capabilityList = capabilities.data?.capabilities;
  const [scope, setScope] = useState<"mine" | "all">("mine");
  const [status, setStatus] = useState<SeriesCreationGrantStatus>();
  const [searchInput, setSearchInput] = useState("");
  const search = useDebouncedAuthorizationValue(searchInput);
  const [userSearch, setUserSearch] = useState("");
  const debouncedUserSearch = useDebouncedAuthorizationValue(userSearch);
  const [targetUserId, setTargetUserId] = useState("");
  const [adminCursors, setAdminCursors] = useState<Array<string | undefined>>([
    undefined,
  ]);
  const [ownPage, setOwnPage] = useState(1);
  const [selectedGrantId, setSelectedGrantId] = useState<string | null>(null);
  const [grantToUse, setGrantToUse] =
    useState<SeriesCreationGrantListItem | null>(null);
  const [useStep, setUseStep] = useState<"confirm" | "series">("confirm");
  const [issueOpen, setIssueOpen] = useState(false);
  const [historyGrantId, setHistoryGrantId] = useState<string | null>(null);
  const [grantToInvalidate, setGrantToInvalidate] = useState<
    SeriesCreationGrantListItem | AdminSeriesCreationGrantListItem | null
  >(null);
  const [feedback, setFeedback] = useState<string | null>(null);
  const createSeries = useCreateSeries();
  const invalidate = useInvalidateSeriesCreationGrant();
  const canReadAll = hasCapability(capabilityList, "discord.series-grant.read");
  const canIssue = hasCapability(capabilityList, "discord.series-grant.issue");
  const canInvalidate = hasCapability(
    capabilityList,
    "discord.series-grant.invalidate",
  );
  const adminCursor = adminCursors.at(-1);
  const mineQuery = useMySeriesCreationGrants(status, scope === "mine");
  const allQuery = useAdminSeriesCreationGrants(
    {
      status,
      search,
      targetUserId: targetUserId || undefined,
      cursor: adminCursor,
    },
    scope === "all" && canReadAll,
  );
  const lookup = useAdminUserLookup(
    debouncedUserSearch,
    scope === "all" && canReadAll,
  );
  const grantsQuery = scope === "mine" ? mineQuery : allQuery;
  const ownGrants = mineQuery.data ?? [];
  const ownFiltered = useMemo(() => {
    const normalized = searchInput.trim().toLocaleLowerCase();
    if (!normalized) return ownGrants;
    return ownGrants.filter((grant) =>
      [grant.displayCode, grant.reference ?? ""].some((value) =>
        value.toLocaleLowerCase().includes(normalized),
      ),
    );
  }, [ownGrants, searchInput]);
  const ownTotalPages = Math.max(
    1,
    Math.ceil(ownFiltered.length / ownPageSize),
  );
  const ownCurrentPage = Math.min(ownPage, ownTotalPages);
  const ownPageGrants = ownFiltered.slice(
    (ownCurrentPage - 1) * ownPageSize,
    ownCurrentPage * ownPageSize,
  );
  const adminGrants = allQuery.data?.items ?? [];
  const grants = scope === "mine" ? ownPageGrants : adminGrants;
  const selectedGrant =
    grants.find((grant) => grant.id === selectedGrantId) ?? null;
  const applicableGrants = useMemo(
    () =>
      ownGrants.filter(
        (grant) => grant.status === "available" && grant.applicable,
      ),
    [ownGrants],
  );
  const userOptions = (lookup.data?.items ?? []).map((user) => ({
    id: user.id,
    label:
      user.displayName && user.email && user.displayName !== user.email
        ? `${user.displayName} — ${user.email}`
        : (user.displayName ?? user.email ?? "Usuario"),
  }));

  function resetAdminPagination() {
    setAdminCursors([undefined]);
    setSelectedGrantId(null);
  }

  function changeScope(nextScope: "mine" | "all") {
    setScope(nextScope);
    setSelectedGrantId(null);
    setTargetUserId("");
    setUserSearch("");
    setOwnPage(1);
    setAdminCursors([undefined]);
  }

  function changeStatus(nextStatus: SeriesCreationGrantStatus | undefined) {
    setStatus(nextStatus);
    setOwnPage(1);
    resetAdminPagination();
  }

  function openUseConfirmation(grant: SeriesCreationGrantListItem) {
    setGrantToUse(grant);
    setUseStep("confirm");
  }

  function copyAuthorizationCode(displayCode: string) {
    void navigator.clipboard.writeText(displayCode);
    setFeedback("Código copiado.");
  }

  async function createFromAuthorization(input: SeriesInput) {
    await createSeries.mutateAsync(input);
    setGrantToUse(null);
    setFeedback("Serie creada y autorización consumida.");
  }

  async function confirmInvalidation() {
    if (!grantToInvalidate) return;
    try {
      await invalidate.mutateAsync(grantToInvalidate.id);
      setFeedback("Autorización invalidada.");
      setGrantToInvalidate(null);
    } catch {
      // The contextual error remains in the confirmation dialog.
    }
  }

  const emptyTitle =
    scope === "mine"
      ? "No tienes autorizaciones."
      : "No hay autorizaciones que coincidan con los filtros.";

  return (
    <>
      <PageHeader
        actions={
          canIssue ? (
            <Button
              icon={<Plus aria-hidden="true" className="size-4" />}
              type="button"
              onClick={() => setIssueOpen(true)}
            >
              Nueva autorización
            </Button>
          ) : undefined
        }
        breadcrumbs={[
          { label: "Dashboard", href: "/" },
          { label: "Autorizaciones", current: true },
        ]}
        description="Consulta las autorizaciones disponibles y el historial para crear Series."
        title="Autorizaciones"
      />
      {feedback ? (
        <p aria-live="polite" className="mb-3 text-sm text-success">
          {feedback}
        </p>
      ) : null}
      <section className="mb-4 grid gap-3 rounded-panel border border-border bg-surface p-3 shadow-card">
        <div
          className="flex flex-wrap gap-2"
          role="tablist"
          aria-label="Alcance de autorizaciones"
        >
          <Button
            aria-selected={scope === "mine"}
            role="tab"
            type="button"
            variant={scope === "mine" ? "primary" : "secondary"}
            onClick={() => changeScope("mine")}
          >
            Mis autorizaciones
          </Button>
          {canReadAll ? (
            <Button
              aria-selected={scope === "all"}
              role="tab"
              type="button"
              variant={scope === "all" ? "primary" : "secondary"}
              onClick={() => changeScope("all")}
            >
              Todas
            </Button>
          ) : null}
        </div>
        <div className="flex flex-wrap items-end gap-2">
          <fieldset className="flex flex-wrap gap-2">
            <legend className="sr-only">Filtrar por estado</legend>
            {statusTabs.map((tab) => (
              <Button
                aria-pressed={status === tab.value}
                key={tab.label}
                type="button"
                variant={status === tab.value ? "primary" : "secondary"}
                onClick={() => changeStatus(tab.value)}
              >
                {tab.label}
              </Button>
            ))}
          </fieldset>
          <div className="ml-auto w-full min-w-[14rem] max-w-sm">
            <SearchInput
              placeholder="Buscar por código, referencia o usuario…"
              value={searchInput}
              onChange={(value) => {
                setSearchInput(value);
                setOwnPage(1);
                resetAdminPagination();
              }}
            />
          </div>
          <div className="w-full sm:w-48">
            <SearchableCombobox
              id="authorization-status"
              label="Estado"
              options={statusOptions}
              placeholder="Todos los estados"
              value={status ?? ""}
              onChange={(value) =>
                changeStatus(
                  value ? (value as SeriesCreationGrantStatus) : undefined,
                )
              }
            />
          </div>
          {scope === "all" ? (
            <div className="w-full sm:w-60">
              <SearchableCombobox
                emptyMessage="No se encontraron usuarios."
                error={
                  lookup.isError
                    ? "No se pudieron cargar los usuarios."
                    : undefined
                }
                id="authorization-user"
                label="Usuario"
                loading={lookup.isPending}
                options={[
                  { id: "", label: "Todos los usuarios" },
                  ...userOptions,
                ]}
                placeholder="Todos los usuarios"
                value={targetUserId}
                onChange={(value) => {
                  setTargetUserId(value);
                  resetAdminPagination();
                }}
                onRetry={() => void lookup.refetch()}
                onSearchChange={setUserSearch}
              />
            </div>
          ) : null}
        </div>
      </section>
      {grantsQuery.isPending ? (
        <LoadingState label="Cargando autorizaciones" />
      ) : null}
      {grantsQuery.isError ? (
        <ErrorState
          action={
            <Button type="button" onClick={() => void grantsQuery.refetch()}>
              Reintentar
            </Button>
          }
          description="Inténtalo nuevamente en unos instantes."
          title="No se pudieron cargar las autorizaciones."
        />
      ) : null}
      {grantsQuery.isSuccess && grants.length === 0 ? (
        <EmptyState
          description={
            scope === "mine"
              ? "Las autorizaciones se obtienen mediante el flujo de Discord."
              : "Ajusta los filtros para consultar otras autorizaciones."
          }
          title={emptyTitle}
        />
      ) : null}
      {grantsQuery.isSuccess && grants.length > 0 ? (
        <section className="grid min-h-0 gap-card xl:grid-cols-[minmax(0,1fr)_minmax(380px,420px)] xl:items-stretch">
          <AuthorizationList
            grants={grants}
            minTableHeightClassName="lg:min-h-[640px]"
            selectedId={selectedGrantId}
            onCopy={copyAuthorizationCode}
            onHistory={canReadAll ? setHistoryGrantId : undefined}
            onInvalidate={canInvalidate ? setGrantToInvalidate : undefined}
            onSelect={setSelectedGrantId}
            {...(scope === "mine" ? { onUse: openUseConfirmation } : {})}
          />
          <aside
            aria-label="Panel contextual de la autorización"
            className="min-h-0 w-full xl:h-full xl:self-stretch"
          >
            <AuthorizationDetailPanel
              grant={selectedGrant}
              isOwnScope={scope === "mine"}
              onClose={() => setSelectedGrantId(null)}
              onHistory={canReadAll ? setHistoryGrantId : undefined}
              onInvalidate={canInvalidate ? setGrantToInvalidate : undefined}
              onUse={openUseConfirmation}
            />
          </aside>
          <div className="order-3 xl:col-start-1 xl:order-none">
            {scope === "mine" ? (
              <Pagination
                page={ownCurrentPage}
                totalItems={ownFiltered.length}
                totalPages={ownTotalPages}
                onNext={() => {
                  setSelectedGrantId(null);
                  setOwnPage((current) => current + 1);
                }}
                onPrevious={() => {
                  setSelectedGrantId(null);
                  setOwnPage((current) => current - 1);
                }}
              />
            ) : (
              <Pagination
                page={adminCursors.length}
                totalItems={grants.length}
                totalPages={
                  allQuery.data?.nextCursor
                    ? adminCursors.length + 1
                    : adminCursors.length
                }
                onNext={() => {
                  if (allQuery.data?.nextCursor) {
                    const nextCursor = allQuery.data.nextCursor;
                    setSelectedGrantId(null);
                    setAdminCursors((current) => [...current, nextCursor]);
                  }
                }}
                onPrevious={() => {
                  setSelectedGrantId(null);
                  setAdminCursors((current) =>
                    current.length > 1 ? current.slice(0, -1) : current,
                  );
                }}
              />
            )}
          </div>
        </section>
      ) : null}
      <AuthorizationIssueDialog open={issueOpen} onOpenChange={setIssueOpen} />
      <AuthorizationHistoryDialog
        grantId={historyGrantId}
        open={Boolean(historyGrantId)}
        onOpenChange={(open) => {
          if (!open) setHistoryGrantId(null);
        }}
      />
      <AppDialog
        busy={invalidate.isPending}
        description="Esta autorización dejará de estar disponible para crear una Serie."
        footer={
          <div className="flex flex-wrap justify-end gap-2">
            <Button
              type="button"
              variant="secondary"
              onClick={() => setGrantToInvalidate(null)}
            >
              Cancelar
            </Button>
            <Button
              loading={invalidate.isPending}
              type="button"
              variant="destructive"
              onClick={() => void confirmInvalidation()}
            >
              Invalidar autorización
            </Button>
          </div>
        }
        open={Boolean(grantToInvalidate)}
        title="Invalidar autorización"
        onOpenChange={(open) => {
          if (!open && !invalidate.isPending) setGrantToInvalidate(null);
        }}
      >
        <p className="m-0 text-sm text-muted">
          {grantToInvalidate?.displayCode}
        </p>
        {invalidate.isError ? (
          <p role="alert" className="mt-3 text-sm text-danger">
            {errorMessage(
              invalidate.error,
              "No se pudo invalidar la autorización.",
            )}
          </p>
        ) : null}
      </AppDialog>
      <AppDialog
        open={Boolean(grantToUse)}
        size="lg"
        title="Usar autorización"
        description={
          useStep === "confirm"
            ? "Confirma la autorización antes de continuar con la creación de la Serie."
            : "Completa los datos para crear la Serie usando esta autorización."
        }
        onOpenChange={(open) => {
          if (!open) {
            setGrantToUse(null);
            setUseStep("confirm");
          }
        }}
        {...(useStep === "confirm" && grantToUse
          ? {
              footer: (
                <div className="flex flex-wrap justify-end gap-2">
                  <Button
                    variant="secondary"
                    type="button"
                    onClick={() => setGrantToUse(null)}
                  >
                    Cancelar
                  </Button>
                  <Button type="button" onClick={() => setUseStep("series")}>
                    Confirmar y continuar
                  </Button>
                </div>
              ),
            }
          : {})}
      >
        {grantToUse ? (
          <div className="grid gap-5">
            <div
              className="grid grid-cols-2 gap-2 text-center text-xs font-medium"
              role="tablist"
              aria-label="Pasos para usar autorización"
            >
              <button
                aria-selected={useStep === "confirm"}
                className={`rounded-control px-3 py-2 ${useStep === "confirm" ? "bg-primary-soft text-text" : "border border-[var(--border-subtle)] text-muted"}`}
                onClick={() => setUseStep("confirm")}
                role="tab"
                type="button"
              >
                1. Confirmar
              </button>
              <button
                aria-selected={useStep === "series"}
                className={`rounded-control px-3 py-2 disabled:cursor-not-allowed disabled:opacity-50 ${useStep === "series" ? "bg-primary-soft text-text" : "border border-[var(--border-subtle)] text-muted"}`}
                disabled={useStep === "confirm"}
                onClick={() => setUseStep("series")}
                role="tab"
                type="button"
              >
                2. Crear Serie
              </button>
            </div>
            {useStep === "confirm" ? (
              <>
                <section className="rounded-control border border-[var(--border-subtle)] bg-surface p-4">
                  <p className="m-0 text-xs font-medium uppercase tracking-[0.08em] text-muted">
                    Autorización seleccionada
                  </p>
                  <div className="mt-2 flex flex-wrap items-center justify-between gap-2">
                    <strong className="font-mono text-sm text-text">
                      {grantToUse.displayCode}
                    </strong>
                    <StatusBadge
                      label={authorizationStatusLabel[grantToUse.status]}
                      tone={authorizationStatusTone[grantToUse.status]}
                    />
                  </div>
                </section>
                <p className="m-0 flex gap-2 rounded-control border border-[var(--border-subtle)] bg-primary-soft p-3 text-sm text-text-secondary">
                  <Info
                    aria-hidden="true"
                    className="mt-0.5 size-4 shrink-0 text-primary"
                  />
                  Al crear la Serie, esta autorización se consumirá y quedará
                  vinculada a ella.
                </p>
              </>
            ) : (
              <SeriesForm
                key={grantToUse.id}
                availableGrants={applicableGrants}
                initial={{ grantId: grantToUse.id }}
                requiresGrant
                onCancel={() => {
                  setGrantToUse(null);
                  setUseStep("confirm");
                }}
                onSubmit={createFromAuthorization}
              />
            )}
          </div>
        ) : null}
      </AppDialog>
    </>
  );
}
