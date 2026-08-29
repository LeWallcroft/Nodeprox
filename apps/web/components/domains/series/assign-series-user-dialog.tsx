"use client";

import { useMemo, useState } from "react";
import type {
  Series,
  SeriesUploaderCandidate,
} from "../../../lib/domains/series/types";
import { Button } from "../../ui/button";
import { ErrorState } from "../../ui/error-state";
import { LoadingState } from "../../ui/loading-state";
import { AppDialog } from "../../ui/app-dialog";

export function AssignSeriesUserDialog({
  open,
  series,
  candidates,
  isLoading,
  error,
  isSubmitting,
  onClose,
  onAssign,
}: {
  open: boolean;
  series: Series;
  candidates: readonly SeriesUploaderCandidate[] | undefined;
  isLoading: boolean;
  error: Error | null;
  isSubmitting: boolean;
  onClose: () => void;
  onAssign: (uploaderId: string) => Promise<void>;
}) {
  const [query, setQuery] = useState("");
  const [selectedId, setSelectedId] = useState("");
  const [submitError, setSubmitError] = useState<string | null>(null);
  const visible = useMemo(
    () =>
      (candidates ?? []).filter((candidate) =>
        `${candidate.discordUsername ?? ""} ${candidate.email}`
          .toLowerCase()
          .includes(query.trim().toLowerCase()),
      ),
    [candidates, query],
  );

  return (
    <AppDialog
      busy={isSubmitting}
      description={series.title}
      open={open}
      size="md"
      title={
        series.principalUploader ? "Cambiar responsable" : "Asignar responsable"
      }
      onOpenChange={(next) => {
        if (!next) onClose();
      }}
      footer={
        <div className="flex justify-end gap-2 max-[480px]:flex-col-reverse">
          <Button
            className="border-border bg-surface text-text hover:bg-hover"
            disabled={isSubmitting}
            type="button"
            onClick={onClose}
          >
            Cancelar
          </Button>
          <Button
            type="button"
            disabled={!selectedId || isSubmitting}
            onClick={() => {
              if (!selectedId) return;
              setSubmitError(null);
              void onAssign(selectedId).catch((cause: unknown) =>
                setSubmitError(
                  cause instanceof Error
                    ? cause.message
                    : "No se pudo asignar el responsable.",
                ),
              );
            }}
          >
            {isSubmitting ? "Asignando…" : "Asignar"}
          </Button>
        </div>
      }
    >
      <p className="mt-4 text-sm">
        Responsable actual:{" "}
        {series.principalUploader?.email ?? "Sin responsable asignado"}
      </p>
      {isLoading ? <LoadingState label="Cargando candidatos" /> : null}
      {error ? (
        <ErrorState
          title="No se pudieron cargar candidatos"
          description={error.message}
        />
      ) : null}
      {!isLoading && !error ? (
        <>
          <label
            className="mt-4 grid gap-1.5 text-sm font-medium text-muted"
            htmlFor="uploader-search"
          >
            Buscar responsable
            <input
              id="uploader-search"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="correo@ejemplo.com"
            />
          </label>
          <div className="mt-3 max-h-52 overflow-y-auto rounded-control border border-border">
            {visible.length ? (
              visible.map((candidate) => (
                <label
                  className="flex cursor-pointer items-center gap-3 border-b border-border px-3 py-2.5 last:border-0 hover:bg-hover"
                  key={candidate.id}
                >
                  <input
                    checked={selectedId === candidate.id}
                    name="uploader"
                    type="radio"
                    value={candidate.id}
                    onChange={() => setSelectedId(candidate.id)}
                  />
                  <span>
                    <span className="block">
                      {candidate.discordUsername ?? candidate.email}
                    </span>
                    {candidate.discordUsername ? (
                      <span className="block text-xs text-muted">
                        {candidate.email}
                      </span>
                    ) : null}
                  </span>
                </label>
              ))
            ) : (
              <p className="m-0 p-3 text-sm text-muted">
                No hay uploaders activos disponibles.
              </p>
            )}
          </div>
        </>
      ) : null}
      {submitError ? (
        <p className="mt-3 text-sm text-danger" role="alert">
          {submitError}
        </p>
      ) : null}
    </AppDialog>
  );
}
