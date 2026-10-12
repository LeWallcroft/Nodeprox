"use client";

import { Eye, RotateCcw, Send, X } from "lucide-react";
import { useState } from "react";
import {
  useSeriesCapabilities,
  useSeriesLifecycle,
  useSeriesLifecycleActions,
} from "../../../lib/domains/series/hooks";
import type { SeriesListProjection } from "../../../lib/domains/series/types";
import {
  userPrimaryLabel,
  userSecondaryLabel,
} from "../../../lib/domains/users/presentation";
import { Button } from "../../ui/button";
import { ContentImage } from "../../ui/content-image";
import {
  DetailPanel,
  DetailPanelActions,
  DetailPanelContent,
  DetailPanelHeader,
} from "../../ui/detail-panel";
import { StatusBadge } from "../../ui/status-badge";
import { UserAvatar } from "../users/user-avatar";
import { ReactivationRequestDialog } from "./reactivation-request-dialog";
import { ReactivationRequestHistoryDialog } from "./reactivation-request-history-dialog";
import { ReactivationReviewDialog } from "./reactivation-review-dialog";

const reasonLabel = {
  dropped: "Dropeada",
  hiatus: "Hiatus",
  completed: "Terminada",
  other: "Otros",
} as const;

const operationalStateLabel = {
  active: "Activa",
  inactive: "Inactiva",
} as const;

const requestStatusLabel = {
  pending: "Pendiente",
  approved: "Aprobada",
  rejected: "Rechazada",
  cancelled: "Cancelada",
} as const;

export function InactiveSeriesDetailPanel({
  series,
  onClose,
}: {
  series: SeriesListProjection;
  onClose: () => void;
}) {
  const lifecycle = useSeriesLifecycle(series.id);
  const capabilities = useSeriesCapabilities(series.id);
  const actions = useSeriesLifecycleActions(series.id);
  const [requestOpen, setRequestOpen] = useState(false);
  const [requestHistoryOpen, setRequestHistoryOpen] = useState(false);
  const [reviewOpen, setReviewOpen] = useState(false);
  const [actionError, setActionError] = useState("");
  const canManage =
    capabilities.data?.capabilities.includes("series.lifecycle.manage") ??
    false;
  const canRequest =
    capabilities.data?.capabilities.includes("series.reactivation.request") ??
    false;
  const isInactive = series.operationalState === "inactive";
  const pending = lifecycle.data?.requests.find(
    (request) => request.status === "pending",
  );
  const requests = lifecycle.data?.requests ?? [];
  const visibleRequests = requests.slice(0, 2);
  return (
    <DetailPanel>
      <DetailPanelHeader>
        <div className="flex items-center justify-between gap-3">
          <h2 className="text-base font-semibold">Detalle histórico</h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Cerrar detalle"
            className="rounded-control p-2 hover:bg-surface-hover"
          >
            <X className="size-4" />
          </button>
        </div>
      </DetailPanelHeader>
      <DetailPanelContent scrollable>
        <div className="flex gap-3">
          <ContentImage
            alt={`Portada de ${series.title}`}
            src={series.coverUrl}
            variant="details"
          />
          <div className="min-w-0">
            <h3 className="text-lg font-semibold">{series.title}</h3>
            <StatusBadge
              label={isInactive ? "Deshabilitada" : "Activa"}
              tone={isInactive ? "warning" : "success"}
            />
            <p className="mt-2 break-all text-xs text-muted">{series.slug}</p>
          </div>
        </div>
        <dl className="mt-5 grid gap-3 text-sm">
          <div>
            <dt className="text-muted">Motivo</dt>
            <dd>
              {series.inactiveReason ? reasonLabel[series.inactiveReason] : "—"}
            </dd>
          </div>
          {series.inactiveReasonDetail ? (
            <div>
              <dt className="text-muted">Detalle</dt>
              <dd className="whitespace-pre-wrap">
                {series.inactiveReasonDetail}
              </dd>
            </div>
          ) : null}
          <div>
            <dt className="text-muted">Responsable</dt>
            <dd>
              {series.responsibleUser ? (
                <span className="flex items-center gap-2">
                  <UserAvatar user={series.responsibleUser} size="sm" />
                  <span>
                    {userPrimaryLabel(series.responsibleUser)}
                    <small className="block text-muted">
                      {userSecondaryLabel(series.responsibleUser)}
                    </small>
                  </span>
                </span>
              ) : (
                "Sin responsable"
              )}
            </dd>
          </div>
          <div>
            <dt className="text-muted">Cambio de estado</dt>
            <dd>{new Date(series.stateChangedAt).toLocaleString("es-PE")}</dd>
          </div>
          <div>
            <dt className="text-muted">Capítulos · Imágenes</dt>
            <dd>
              {series.chapterCount} · {series.imageCount}
            </dd>
          </div>
        </dl>
        <h4 className="mt-6 font-semibold">Solicitudes</h4>
        {lifecycle.isLoading ? (
          <p className="text-muted">Cargando historial…</p>
        ) : null}
        {lifecycle.isError ? (
          <p role="alert">
            No se pudo cargar el historial.{" "}
            <button
              type="button"
              className="text-primary"
              onClick={() => void lifecycle.refetch()}
            >
              Reintentar
            </button>
          </p>
        ) : null}
        {requests.length ? (
          <ul className="mt-2 grid gap-2 text-sm">
            {visibleRequests.map((request) => (
              <li
                key={request.id}
                className="rounded-control bg-surface-elevated p-3"
              >
                <strong>{requestStatusLabel[request.status]}</strong> ·{" "}
                {new Date(request.requestedAt).toLocaleString("es-PE")}
                <p className="mt-1 text-muted">
                  Solicitó: {request.requestedByLabel}
                </p>
                {request.requestNote ? <p>{request.requestNote}</p> : null}
                {request.resolutionNote ? (
                  <p className="text-muted">
                    Resolución: {request.resolutionNote}
                  </p>
                ) : null}
              </li>
            ))}
            {requests.length > visibleRequests.length ? (
              <li>
                <button
                  type="button"
                  onClick={() => setRequestHistoryOpen(true)}
                  className="inline-flex items-center gap-1.5 rounded-control px-1 py-1 text-sm font-medium text-primary hover:bg-primary/10 hover:text-primary-hover focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary"
                  aria-label={`Ver más: historial completo de ${requests.length} solicitudes`}
                >
                  <Eye aria-hidden="true" className="size-4" />
                  Ver más ({requests.length})
                </button>
              </li>
            ) : null}
          </ul>
        ) : (
          <p className="text-muted">Sin solicitudes.</p>
        )}
        <h4 className="mt-6 font-semibold">Historial</h4>
        {lifecycle.data?.history.length ? (
          <ol className="mt-2 grid gap-2 text-sm">
            {lifecycle.data.history.map((entry) => (
              <li
                key={entry.id}
                className="rounded-control bg-surface-elevated p-3"
              >
                <strong>
                  {operationalStateLabel[entry.previousState]}
                  {" → "}
                  {operationalStateLabel[entry.nextState]}
                </strong>
                {entry.inactiveReason ? (
                  <p>Motivo: {reasonLabel[entry.inactiveReason]}</p>
                ) : null}
                {entry.inactiveReasonDetail ? (
                  <p>Detalle: {entry.inactiveReasonDetail}</p>
                ) : null}
                <p>{new Date(entry.occurredAt).toLocaleString("es-PE")}</p>
                {entry.responsibleLabelSnapshot ? (
                  <p className="text-muted">
                    Responsable: {entry.responsibleLabelSnapshot}
                  </p>
                ) : null}
              </li>
            ))}
          </ol>
        ) : (
          <p className="text-muted">Sin cambios anteriores.</p>
        )}
        {actionError ? (
          <p role="alert" className="mt-3 text-destructive-text">
            {actionError}
          </p>
        ) : null}
      </DetailPanelContent>
      <DetailPanelActions>
        {isInactive && canManage ? (
          <>
            {pending ? (
              <Button type="button" onClick={() => setReviewOpen(true)}>
                <RotateCcw className="size-4" /> Revisar solicitud
              </Button>
            ) : null}
            <Button
              variant="secondary"
              type="button"
              disabled={actions.reactivate.isPending}
              onClick={() => {
                setActionError("");
                void actions.reactivate
                  .mutateAsync(undefined)
                  .catch((cause: unknown) =>
                    setActionError(
                      cause instanceof Error
                        ? cause.message
                        : "No se pudo habilitar.",
                    ),
                  );
              }}
            >
              <RotateCcw className="size-4" /> Habilitar serie
            </Button>
          </>
        ) : null}
        {isInactive && canRequest ? (
          pending ? (
            <StatusBadge label="Solicitud pendiente" tone="info" />
          ) : (
            <Button type="button" onClick={() => setRequestOpen(true)}>
              <Send className="size-4" /> Solicitar habilitación
            </Button>
          )
        ) : null}
      </DetailPanelActions>
      <ReactivationRequestDialog
        open={requestOpen}
        onOpenChange={setRequestOpen}
        pending={actions.request.isPending}
        onConfirm={(note) =>
          actions.request.mutateAsync(note).then(() => undefined)
        }
      />
      <ReactivationRequestHistoryDialog
        open={requestHistoryOpen}
        onOpenChange={setRequestHistoryOpen}
        seriesTitle={series.title}
        requests={requests}
      />
      <ReactivationReviewDialog
        open={reviewOpen}
        onOpenChange={setReviewOpen}
        pending={actions.approve.isPending || actions.reject.isPending}
        onReview={(decision, resolutionNote) =>
          (decision === "approve" ? actions.approve : actions.reject)
            .mutateAsync({
              reactivationRequestId: pending?.id ?? "",
              ...(resolutionNote ? { resolutionNote } : {}),
            })
            .then(() => undefined)
        }
      />
    </DetailPanel>
  );
}
