"use client";

import { useState } from "react";
import { useSeriesList } from "../../../lib/domains/series/hooks";
import { AppDialog } from "../../ui/app-dialog";
import { Button } from "../../ui/button";
import { SearchableCombobox } from "../../ui/searchable-combobox";
import { BulkChapterUploadDialog } from "./bulk-chapter-upload-dialog";

export function GlobalChapterBulkUploadDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const series = useSeriesList();
  const [seriesId, setSeriesId] = useState("");
  const [batchOpen, setBatchOpen] = useState(false);
  const selected = (series.data ?? []).find((item) => item.id === seriesId);
  function close() {
    setSeriesId("");
    setBatchOpen(false);
    onOpenChange(false);
  }
  return (
    <>
      <AppDialog
        open={open && !batchOpen}
        onOpenChange={(next) => next || close()}
        title="Subir capítulos"
        description="Selecciona una serie y luego arrastra uno o varios ZIP. Podrás confirmar el número de cada capítulo antes de iniciar la carga."
      >
        <div className="grid gap-4">
          <SearchableCombobox
            id="global-bulk-series"
            label="Serie"
            required
            value={seriesId}
            options={(series.data ?? []).map((item) => ({
              id: item.id,
              label: item.title,
              description: item.slug,
              imageUrl: item.coverUrl,
            }))}
            loading={series.isPending}
            error={
              series.isError ? "No se pudieron cargar las series." : undefined
            }
            onRetry={() => void series.refetch()}
            placeholder="Buscar serie…"
            emptyMessage="No hay series disponibles."
            onChange={setSeriesId}
          />
          <div className="flex justify-end gap-2">
            <Button variant="secondary" type="button" onClick={close}>
              Cancelar
            </Button>
            <Button
              type="button"
              disabled={!selected}
              onClick={() => setBatchOpen(true)}
            >
              Continuar
            </Button>
          </div>
        </div>
      </AppDialog>
      {selected ? (
        <BulkChapterUploadDialog
          open={batchOpen}
          onOpenChange={(next) => {
            setBatchOpen(next);
            if (!next) close();
          }}
          onBack={() => setBatchOpen(false)}
          seriesId={selected.id}
          seriesTitle={selected.title}
        />
      ) : null}
    </>
  );
}
