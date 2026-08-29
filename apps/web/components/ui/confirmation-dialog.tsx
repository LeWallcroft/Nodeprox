"use client";

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
  onConfirm,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description: string;
  confirmLabel: string;
  pending?: boolean;
  error?: string | null;
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
          <Button
            variant="destructive"
            disabled={pending}
            type="button"
            onClick={onConfirm}
          >
            {pending ? "Procesando…" : confirmLabel}
          </Button>
        </div>
      }
    >
      {error ? (
        <p className="m-0 text-sm text-danger" role="alert">
          {error}
        </p>
      ) : null}
    </AppDialog>
  );
}
