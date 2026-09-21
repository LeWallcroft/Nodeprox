"use client";

import { Ban, Check, Copy, History, Ticket, X } from "lucide-react";
import { useState } from "react";
import type {
  AdminSeriesCreationGrantListItem,
  SeriesCreationGrantListItem,
} from "../../../lib/domains/authorizations/types";
import {
  authorizationStatusLabel,
  authorizationStatusTone,
} from "../../../lib/domains/authorizations/view-model";
import { Button } from "../../ui/button";
import {
  DetailPanel,
  DetailPanelActions,
  DetailPanelContent,
  DetailPanelHeader,
} from "../../ui/detail-panel";
import { EmptyState } from "../../ui/empty-state";
import { StatusBadge } from "../../ui/status-badge";

type AuthorizationGrant =
  | SeriesCreationGrantListItem
  | AdminSeriesCreationGrantListItem;

export function AuthorizationDetailPanel({
  grant,
  isOwnScope,
  onClose,
  onUse,
  onHistory,
  onInvalidate,
}: {
  grant: AuthorizationGrant | null;
  isOwnScope: boolean;
  onClose: () => void;
  onUse: (grant: SeriesCreationGrantListItem) => void;
  onHistory?: ((grantId: string) => void) | undefined;
  onInvalidate?: ((grant: AuthorizationGrant) => void) | undefined;
}) {
  const [copied, setCopied] = useState(false);

  if (!grant)
    return (
      <DetailPanel>
        <DetailPanelHeader>
          <h2 className="m-0 text-base font-semibold">Detalle</h2>
        </DetailPanelHeader>
        <DetailPanelContent>
          <EmptyState
            title="Selecciona una autorización"
            description="El detalle y las acciones disponibles aparecerán aquí."
          />
        </DetailPanelContent>
      </DetailPanel>
    );

  const selectedGrant = grant;

  const canUse =
    isOwnScope &&
    selectedGrant.status === "available" &&
    selectedGrant.applicable === true;
  const owner =
    "targetUser" in selectedGrant
      ? selectedGrant.targetUser.displayName
      : "Tu autorización";

  async function copyCode() {
    await navigator.clipboard.writeText(selectedGrant.displayCode);
    setCopied(true);
  }

  return (
    <DetailPanel>
      <DetailPanelHeader>
        <div className="flex items-start justify-between gap-3">
          <div className="flex min-w-0 items-center gap-2">
            <Ticket
              aria-hidden="true"
              className="size-4 shrink-0 text-primary"
            />
            <h2 className="m-0 truncate text-base font-semibold">
              Detalle de autorización
            </h2>
          </div>
          <button
            aria-label="Cerrar detalle"
            className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-control border border-border bg-surface-elevated text-text focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary"
            type="button"
            onClick={onClose}
          >
            <X aria-hidden="true" className="size-4" />
          </button>
        </div>
      </DetailPanelHeader>
      <DetailPanelContent>
        <div className="grid gap-3">
          <p className="m-0 text-xs font-medium uppercase tracking-[0.08em] text-muted">
            Autorización seleccionada
          </p>
          <div className="flex min-w-0 items-center justify-between gap-2">
            <p className="m-0 truncate font-mono text-lg font-semibold text-text">
              {selectedGrant.displayCode}
            </p>
            <Button
              aria-label="Copiar código"
              className="shrink-0"
              size="sm"
              variant="secondary"
              type="button"
              onClick={() => void copyCode()}
            >
              {copied ? (
                <Check aria-hidden="true" className="size-4" />
              ) : (
                <Copy aria-hidden="true" className="size-4" />
              )}
              {copied ? "Copiado" : "Copiar"}
            </Button>
          </div>
          <div>
            <StatusBadge
              label={authorizationStatusLabel[selectedGrant.status]}
              tone={authorizationStatusTone[selectedGrant.status]}
            />
          </div>
          {"consumedAt" in selectedGrant && selectedGrant.consumedAt ? (
            <div>
              <dt className="text-xs font-medium uppercase tracking-[0.08em] text-muted">
                Consumida en
              </dt>
              <dd className="mt-1 text-muted">
                {new Date(selectedGrant.consumedAt).toLocaleString("es-PE")}
              </dd>
            </div>
          ) : null}
          {"createdSeries" in selectedGrant && selectedGrant.createdSeries ? (
            <div>
              <dt className="text-xs font-medium uppercase tracking-[0.08em] text-muted">
                Serie creada
              </dt>
              <dd className="mt-1 min-w-0 text-muted">
                <span className="block truncate">
                  {selectedGrant.createdSeries.title}
                </span>
                <span className="block truncate text-xs">
                  {selectedGrant.createdSeries.slug}
                </span>
              </dd>
            </div>
          ) : null}
        </div>
        <dl className="mt-5 grid gap-4 text-sm">
          <div>
            <dt className="text-xs font-medium uppercase tracking-[0.08em] text-muted">
              Código
            </dt>
            <dd className="mt-1 break-all font-mono text-muted">
              {selectedGrant.displayCode}
            </dd>
          </div>
          <div>
            <dt className="text-xs font-medium uppercase tracking-[0.08em] text-muted">
              Referencia
            </dt>
            <dd className="mt-1 break-words text-muted">
              {selectedGrant.reference ?? "Sin referencia."}
            </dd>
          </div>
          <div>
            <dt className="text-xs font-medium uppercase tracking-[0.08em] text-muted">
              Emitida
            </dt>
            <dd className="mt-1 text-muted">
              {new Date(selectedGrant.issuedAt).toLocaleString("es-PE")}
            </dd>
          </div>
          <div>
            <dt className="text-xs font-medium uppercase tracking-[0.08em] text-muted">
              Usuario propietario
            </dt>
            <dd className="mt-1 truncate text-muted">{owner}</dd>
          </div>
          {selectedGrant.status === "available" &&
          !selectedGrant.applicable &&
          isOwnScope ? (
            <div>
              <dt className="text-xs font-medium uppercase tracking-[0.08em] text-muted">
                Aplicabilidad
              </dt>
              <dd className="mt-1 text-muted">
                No requerida con tu rol actual.
              </dd>
            </div>
          ) : null}
        </dl>
      </DetailPanelContent>
      <DetailPanelActions>
        {canUse ? (
          <Button type="button" onClick={() => onUse(selectedGrant)}>
            Usar autorización
          </Button>
        ) : null}
        {onHistory ? (
          <Button
            type="button"
            variant="secondary"
            icon={<History aria-hidden="true" className="size-4" />}
            onClick={() => onHistory(selectedGrant.id)}
          >
            Ver historial de uso
          </Button>
        ) : null}
        {onInvalidate && selectedGrant.status === "available" ? (
          <Button
            type="button"
            variant="destructive"
            icon={<Ban aria-hidden="true" className="size-4" />}
            onClick={() => onInvalidate(selectedGrant)}
          >
            Invalidar autorización
          </Button>
        ) : null}
      </DetailPanelActions>
    </DetailPanel>
  );
}
