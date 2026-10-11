"use client";

import { useState } from "react";
import { AppDialog } from "../../ui/app-dialog";
import { Button } from "../../ui/button";
import type { Series } from "../../../lib/domains/series/types";

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
                    cause instanceof Error
                      ? cause.message
                      : "No se pudo deshabilitar la serie.",
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
        <label className="grid gap-1 text-sm">
          Motivo
          <select
            className="min-h-control rounded-control border border-border bg-surface px-3"
            value={reason}
            onChange={(event) => setReason(event.target.value as typeof reason)}
          >
            {reasons.map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
        </label>
        <label className="grid gap-1 text-sm">
          Detalle del motivo{" "}
          {reason === "other" ? "(obligatorio)" : "(opcional)"}
          <textarea
            className="min-h-24 rounded-control border border-border bg-surface p-3"
            maxLength={1000}
            value={detail}
            onChange={(event) => setDetail(event.target.value)}
          />
        </label>
        {error ? (
          <p role="alert" className="text-destructive-text">
            {error}
          </p>
        ) : null}
      </div>
    </AppDialog>
  );
}
