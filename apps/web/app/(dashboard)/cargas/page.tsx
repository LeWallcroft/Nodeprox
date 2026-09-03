"use client";

import { useState } from "react";
import { BulkChapterUploadDialog } from "../../../components/domains/chapters/bulk-chapter-upload-dialog";
import { PageHeader } from "../../../components/layout/page-header";
import { Button } from "../../../components/ui/button";
import { useSeriesList } from "../../../lib/domains/series/hooks";

export default function BulkUploadPage() {
  const series = useSeriesList();
  const [seriesId, setSeriesId] = useState("");
  const [open, setOpen] = useState(false);
  const selected = series.data?.find((item) => item.id === seriesId) ?? null;
  return (
    <>
      <PageHeader
        title="Carga masiva"
        description="Crea un batch y sigue cada ZIP desde el Centro de cargas mientras navegas."
        breadcrumbs={[
          { label: "Dashboard", href: "/" },
          { label: "Cargas", current: true },
        ]}
      />
      <section className="grid max-w-xl gap-4 rounded-xl border border-border bg-surface p-5">
        <label className="grid gap-1.5 text-sm font-semibold">
          Series
          <select
            value={seriesId}
            onChange={(event) => setSeriesId(event.target.value)}
          >
            <option value="">Selecciona una Series</option>
            {series.data?.map((item) => (
              <option key={item.id} value={item.id}>
                {item.title}
              </option>
            ))}
          </select>
        </label>
        <Button
          type="button"
          disabled={!selected}
          onClick={() => setOpen(true)}
        >
          Configurar carga masiva
        </Button>
      </section>
      {selected ? (
        <BulkChapterUploadDialog
          open={open}
          onOpenChange={setOpen}
          seriesId={selected.id}
          seriesTitle={selected.title}
        />
      ) : null}
    </>
  );
}
