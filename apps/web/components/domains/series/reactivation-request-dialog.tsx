"use client";

import { useState } from "react";
import { AppDialog } from "../../ui/app-dialog";
import { Button } from "../../ui/button";

export function ReactivationRequestDialog({
  open,
  onOpenChange,
  onConfirm,
  pending,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onConfirm: (note?: string) => Promise<void>;
  pending: boolean;
}) {
  const [note, setNote] = useState("");
  const [error, setError] = useState("");
  return (
    <AppDialog
      open={open}
      onOpenChange={onOpenChange}
      title="Solicitar habilitación"
      description="Un administrador revisará la solicitud. La serie permanecerá deshabilitada hasta su aprobación."
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
            disabled={pending}
            onClick={() => {
              setError("");
              void onConfirm(note.trim() || undefined)
                .then(() => onOpenChange(false))
                .catch((cause: unknown) =>
                  setError(
                    cause instanceof Error
                      ? cause.message
                      : "No se pudo crear la solicitud.",
                  ),
                );
            }}
          >
            Solicitar habilitación
          </Button>
        </>
      }
    >
      <label className="grid gap-1 text-sm">
        Nota (opcional)
        <textarea
          className="min-h-24 rounded-control border border-border bg-surface p-3"
          maxLength={1000}
          value={note}
          onChange={(event) => setNote(event.target.value)}
        />
      </label>
      {error ? (
        <p role="alert" className="text-destructive-text">
          {error}
        </p>
      ) : null}
    </AppDialog>
  );
}
