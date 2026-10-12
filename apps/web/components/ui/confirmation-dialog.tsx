"use client";

import { CircleAlert } from "lucide-react";
import { AppDialog } from "./app-dialog";
import { Button } from "./button";

export function ConfirmationDialog({
  open,
  onOpenChange,
  title,
  description,
  confirmLabel,
  pending = false,
  error,
  confirmActionVisible = true,
  alternativeAction,
  onConfirm,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description: string;
  confirmLabel: string;
  pending?: boolean;
  error?: string | null;
  confirmActionVisible?: boolean;
  alternativeAction?: { label: string; onClick: () => void };
  onConfirm: () => void;
}) {
  return (
    <AppDialog
      busy={pending}
      description={description}
      open={open}
      size="sm"
      title={title}
      onOpenChange={onOpenChange}
      footer={
        <div className="flex justify-end gap-2 max-[480px]:flex-col-reverse">
          <Button
            variant="secondary"
            disabled={pending}
            type="button"
            onClick={() => onOpenChange(false)}
          >
            Cancelar
          </Button>
          {alternativeAction ? (
            <Button
              variant="destructive"
              disabled={pending}
              type="button"
              onClick={alternativeAction.onClick}
            >
              {alternativeAction.label}
            </Button>
          ) : null}
          {confirmActionVisible ? (
            <Button
              variant="destructive"
              disabled={pending}
              type="button"
              onClick={onConfirm}
            >
              {pending ? "Procesando…" : confirmLabel}
            </Button>
          ) : null}
        </div>
      }
    >
      {error ? (
        <div
          className="flex items-start gap-3 rounded-control bg-destructive-surface p-3 text-sm text-destructive-text"
          role="alert"
          aria-live="assertive"
        >
          <CircleAlert aria-hidden="true" className="mt-0.5 size-4 shrink-0" />
          <p className="m-0">{error}</p>
        </div>
      ) : null}
    </AppDialog>
  );
}
