"use client";

import { useState } from "react";
import { AppDialog } from "../../ui/app-dialog";
import { Button } from "../../ui/button";

export function ReactivationReviewDialog({
  open,
  onOpenChange,
  onReview,
  pending,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onReview: (
    decision: "approve" | "reject",
    resolutionNote?: string,
  ) => Promise<void>;
  pending: boolean;
}) {
  const [note, setNote] = useState("");
  const [error, setError] = useState("");
  function review(decision: "approve" | "reject") {
    setError("");
    void onReview(decision, note.trim() || undefined)
      .then(() => onOpenChange(false))
      .catch((cause: unknown) =>
        setError(
          cause instanceof Error
            ? cause.message
            : "No se pudo revisar la solicitud.",
        ),
      );
  }
  return (
    <AppDialog
      open={open}
      onOpenChange={onOpenChange}
      title="Revisar habilitación"
      description="Aprobar habilita la serie inmediatamente. Rechazar la mantiene deshabilitada."
      busy={pending}
      footer={
        <>
          <Button
            variant="secondary"
            type="button"
            onClick={() => review("reject")}
            disabled={pending}
          >
            Rechazar
          </Button>
          <Button
            type="button"
            onClick={() => review("approve")}
            disabled={pending}
          >
            Aprobar
          </Button>
        </>
      }
    >
      <label className="grid gap-1 text-sm">
        Nota de resolución (opcional)
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
