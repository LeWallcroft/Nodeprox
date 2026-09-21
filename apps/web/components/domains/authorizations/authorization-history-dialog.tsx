"use client";

import { CheckCircle2, CircleSlash2, Clock3, Ticket } from "lucide-react";
import { useSeriesCreationGrantHistory } from "../../../lib/domains/authorizations/hooks";
import { errorMessage } from "../feedback";
import { AppDialog } from "../../ui/app-dialog";
import { Button } from "../../ui/button";

const historyPresentation = {
  issued: { label: "Emitida", icon: Ticket },
  consumed: { label: "Consumida", icon: CheckCircle2 },
  invalidated: { label: "Invalidada", icon: CircleSlash2 },
} as const;

export function AuthorizationHistoryDialog({
  grantId,
  open,
  onOpenChange,
}: {
  grantId: string | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const history = useSeriesCreationGrantHistory(open ? grantId : null);
  return (
    <AppDialog
      footer={
        <div className="flex justify-end">
          <Button
            type="button"
            variant="secondary"
            onClick={() => onOpenChange(false)}
          >
            Cerrar
          </Button>
        </div>
      }
      open={open}
      title="Historial de uso"
      onOpenChange={onOpenChange}
    >
      {history.isPending ? (
        <p className="m-0 text-sm text-muted">Cargando historial…</p>
      ) : null}
      {history.isError ? (
        <div className="grid gap-3">
          <p role="alert" className="m-0 text-sm text-danger">
            {errorMessage(history.error, "No se pudo cargar el historial.")}
          </p>
          <Button
            type="button"
            variant="secondary"
            onClick={() => void history.refetch()}
          >
            Reintentar
          </Button>
        </div>
      ) : null}
      {history.isSuccess ? (
        <ol className="m-0 grid list-none gap-4 p-0">
          {history.data.items.map((item) => {
            const presentation = historyPresentation[item.type];
            const Icon = presentation.icon;
            return (
              <li
                key={`${item.type}-${item.occurredAt}`}
                className="flex gap-3"
              >
                <span className="mt-0.5 grid size-8 shrink-0 place-items-center rounded-full bg-primary-soft text-primary">
                  <Icon aria-hidden="true" className="size-4" />
                </span>
                <div className="min-w-0">
                  <p className="m-0 text-sm font-medium">
                    {presentation.label}
                  </p>
                  <p className="mt-1 text-xs text-muted">
                    {new Date(item.occurredAt).toLocaleString("es-PE")}
                  </p>
                  {item.actor ? (
                    <p className="mt-1 text-sm text-text-secondary">
                      {item.actor.displayName ?? "Usuario"}
                    </p>
                  ) : null}
                  {item.series ? (
                    <p className="mt-1 truncate text-sm text-text-secondary">
                      Serie: {item.series.title}
                    </p>
                  ) : null}
                </div>
              </li>
            );
          })}
          {!history.data.items.length ? (
            <li className="flex items-center gap-2 text-sm text-muted">
              <Clock3 aria-hidden="true" className="size-4" /> Sin eventos
              disponibles.
            </li>
          ) : null}
        </ol>
      ) : null}
    </AppDialog>
  );
}
