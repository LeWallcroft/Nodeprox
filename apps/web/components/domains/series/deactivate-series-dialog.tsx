"use client";

import { CircleAlert } from "lucide-react";
import { useState } from "react";
import type { Series } from "../../../lib/domains/series/types";
import { AppDialog } from "../../ui/app-dialog";
import { Button } from "../../ui/button";
import { SearchableCombobox } from "../../ui/searchable-combobox";
import { errorMessage } from "../feedback";

const reasons = [
  ["dropped", "Dropeada"],
  ["hiatus", "Hiatus"],
  ["completed", "Terminada"],
  ["other", "Otros"],
] as const;

export function DeactivateSeriesDialog({
  open,
  onOpenChange,
  onConfirm,
  pending,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onConfirm: (input: {
    reason: NonNullable<Series["inactiveReason"]>;
    reasonDetail?: string;
  }) => Promise<void>;
  pending: boolean;
}) {
  const [reason, setReason] =
    useState<NonNullable<Series["inactiveReason"]>>("hiatus");
  const [detail, setDetail] = useState("");
  const [error, setError] = useState("");
  return (
    <AppDialog
      open={open}
      onOpenChange={onOpenChange}
      title="Deshabilitar serie"
      description="La serie y su contenido permanecen almacenados. No se podrá modificar el contenido hasta que se habilite de nuevo."
      busy={pending}
      footer={
        <>
          <Button
            variant="secondary"
            type="button"
            onClick={() => onOpenChange(false)}
          >
            Cancelar
          </Button>
          <Button
            variant="destructive"
            type="button"
            disabled={pending || (reason === "other" && !detail.trim())}
            onClick={() => {
              setError("");
              void onConfirm({
                reason,
                ...(detail.trim() ? { reasonDetail: detail.trim() } : {}),
              })
                .then(() => onOpenChange(false))
                .catch((cause: unknown) =>
                  setError(
                    errorMessage(cause, "No se pudo deshabilitar la serie."),
                  ),
                );
            }}
          >
            Deshabilitar serie
          </Button>
        </>
      }
    >
      <div className="grid gap-3">
        <SearchableCombobox
          id="series-deactivation-reason"
          label="Motivo"
          value={reason}
          options={reasons.map(([id, label]) => ({ id, label }))}
          onChange={(value) => {
            setReason(value as typeof reason);
            setError("");
          }}
          placeholder="Selecciona el motivo…"
        />
        <label className="grid gap-1 text-sm">
          Detalle del motivo{" "}
          {reason === "other" ? "(obligatorio)" : "(opcional)"}
          <textarea
            aria-describedby={
              reason === "other" ? "deactivation-detail-hint" : undefined
            }
            aria-invalid={reason === "other" && !detail.trim()}
            className="min-h-24 rounded-control border border-border bg-surface p-3"
            maxLength={1000}
            value={detail}
            onChange={(event) => {
              setDetail(event.target.value);
              setError("");
            }}
          />
          {reason === "other" && !detail.trim() ? (
            <span
              id="deactivation-detail-hint"
              className="text-xs text-warning"
            >
              Explica brevemente el motivo para poder deshabilitar la serie.
            </span>
          ) : null}
        </label>
        {error ? (
          <div
            role="alert"
            aria-live="assertive"
            className="flex items-start gap-3 rounded-control bg-destructive-surface p-3 text-sm text-destructive-text"
          >
            <CircleAlert
              aria-hidden="true"
              className="mt-0.5 size-4 shrink-0"
            />
            <p className="m-0">{error}</p>
          </div>
        ) : null}
      </div>
    </AppDialog>
  );
}
