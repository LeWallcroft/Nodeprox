"use client";

import type { SeriesLifecycleDetail } from "../../../lib/domains/series/types";
import { AppDialog } from "../../ui/app-dialog";

const requestStatusLabel = {
  pending: "Pendiente",
  approved: "Aprobada",
  rejected: "Rechazada",
  cancelled: "Cancelada",
} as const;

type ReactivationRequest = SeriesLifecycleDetail["requests"][number];

export function ReactivationRequestHistoryDialog({
  open,
  onOpenChange,
  seriesTitle,
  requests,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  seriesTitle: string;
  requests: readonly ReactivationRequest[];
}) {
  return (
    <AppDialog
      open={open}
      onOpenChange={onOpenChange}
      title="Historial de solicitudes"
      description={`Solicitudes de habilitación para ${seriesTitle}.`}
      size="md"
      chrome="soft"
    >
      {requests.length ? (
        <ol className="grid gap-3 text-sm">
          {requests.map((request) => (
            <li key={request.id} className="rounded-control bg-surface p-4">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <strong>{requestStatusLabel[request.status]}</strong>
                <time
                  className="text-xs text-muted"
                  dateTime={request.requestedAt}
                >
                  {new Date(request.requestedAt).toLocaleString("es-PE")}
                </time>
              </div>
              <p className="mt-2 text-secondary">
                Solicitó: {request.requestedByLabel}
              </p>
              {request.requestNote ? (
                <div className="mt-3">
                  <p className="text-xs text-muted">Motivo de la solicitud</p>
                  <p className="whitespace-pre-wrap">{request.requestNote}</p>
                </div>
              ) : null}
              {request.reviewedAt ? (
                <p className="mt-3 text-xs text-muted">
                  Revisada:{" "}
                  {new Date(request.reviewedAt).toLocaleString("es-PE")}
                </p>
              ) : null}
              {request.resolutionNote ? (
                <div className="mt-2">
                  <p className="text-xs text-muted">Resolución</p>
                  <p className="whitespace-pre-wrap">
                    {request.resolutionNote}
                  </p>
                </div>
              ) : null}
            </li>
          ))}
        </ol>
      ) : (
        <p className="text-sm text-muted">Sin solicitudes registradas.</p>
      )}
    </AppDialog>
  );
}
