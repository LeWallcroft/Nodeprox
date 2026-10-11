"use client";

import { useState } from "react";
import { RotateCcw, Send, X } from "lucide-react";
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
import { ReactivationReviewDialog } from "./reactivation-review-dialog";

const reasonLabel = {
  dropped: "Dropeada",
  hiatus: "Hiatus",
  completed: "Terminada",
  other: "Otros",
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
  const [reviewOpen, setReviewOpen] = useState(false);
  const [actionError, setActionError] = useState("");
  const canManage =
    capabilities.data?.capabilities.includes("series.lifecycle.manage") ??
    false;
  const canRequest =
    capabilities.data?.capabilities.includes("series.reactivation.request") ??
    false;
  const pending = lifecycle.data?.requests.find(
    (request) => request.status === "pending",
  );
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
            <StatusBadge label="Deshabilitada" tone="warning" />
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
        {lifecycle.data?.requests.length ? (
          <ul className="mt-2 grid gap-2 text-sm">
            {lifecycle.data.requests.map((request) => (
              <li
                key={request.id}
                className="rounded-control bg-surface-elevated p-3"
              >
                <strong>{request.status}</strong> ·{" "}
                {new Date(request.requestedAt).toLocaleString("es-PE")}
                {request.requestNote ? <p>{request.requestNote}</p> : null}
                {request.resolutionNote ? (
                  <p className="text-muted">
                    Resolución: {request.resolutionNote}
                  </p>
                ) : null}
              </li>
            ))}
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
                  {entry.previousState} → {entry.nextState}
                </strong>
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
        {canManage ? (
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
        {canRequest ? (
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
      <ReactivationReviewDialog
        open={reviewOpen}
        onOpenChange={setReviewOpen}
        pending={actions.approve.isPending || actions.reject.isPending}
        onReview={(decision, resolutionNote) =>
          (decision === "approve" ? actions.approve : actions.reject)
            .mutateAsync({
              requestId: pending?.id ?? "",
              ...(resolutionNote ? { resolutionNote } : {}),
            })
            .then(() => undefined)
        }
      />
    </DetailPanel>
  );
}
