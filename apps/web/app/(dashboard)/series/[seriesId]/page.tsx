"use client";

import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useState } from "react";
import { PageHeader } from "../../../../components/layout/page-header";
import { SeriesForm } from "../../../../components/domains/series/series-form";
import { errorMessage } from "../../../../components/domains/feedback";
import { Button } from "../../../../components/ui/button";
import { EmptyState } from "../../../../components/ui/empty-state";
import { ErrorState } from "../../../../components/ui/error-state";
import { Skeleton } from "../../../../components/ui/skeleton";
import {
  useDeleteSeries,
  useSeries,
  useUpdateSeries,
} from "../../../../lib/domains/series/hooks";
import type { SeriesInput } from "../../../../lib/domains/series/types";

export default function SeriesDetailPage() {
  const params = useParams<{ seriesId: string }>();
  const router = useRouter();
  const seriesId = params.seriesId;
  const query = useSeries(seriesId);
  const update = useUpdateSeries(seriesId);
  const remove = useDeleteSeries();
  const [editing, setEditing] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);

  async function handleUpdate(input: SeriesInput) {
    await update.mutateAsync(input);
    setEditing(false);
  }

  async function handleDelete() {
    if (!window.confirm("¿Eliminar esta Series?")) return;
    setActionError(null);
    try {
      await remove.mutateAsync(seriesId);
      router.push("/series");
    } catch (cause) {
      setActionError(errorMessage(cause));
    }
  }

  if (query.isPending)
    return (
      <section className="grid gap-3 rounded-xl border border-border bg-surface p-5">
        <Skeleton />
        <Skeleton />
        <Skeleton />
      </section>
    );
  if (query.isError)
    return (
      <ErrorState
        title="No se pudo cargar la Series"
        description={errorMessage(query.error)}
        action={
          <Button type="button" onClick={() => void query.refetch()}>
            Reintentar
          </Button>
        }
      />
    );
  if (!query.data)
    return (
      <EmptyState
        title="Series no encontrada"
        description="La Series solicitada ya no está disponible."
      />
    );
  const series = query.data;

  return (
    <>
      <PageHeader
        title={series.title}
        description={series.description || "Sin descripción."}
        breadcrumbs={[
          { label: "Dashboard", href: "/" },
          { label: "Series", href: "/series" },
          { label: series.title, current: true },
        ]}
        actions={
          <div className="flex gap-2">
            <Button type="button" onClick={() => setEditing((value) => !value)}>
              {editing ? "Cerrar edición" : "Editar"}
            </Button>
            <button
              className="inline-flex min-h-control items-center justify-center rounded-lg border border-[#a52f2f] bg-surface px-3.5 font-semibold text-[#a52f2f]"
              type="button"
              onClick={() => void handleDelete()}
            >
              Eliminar
            </button>
          </div>
        }
      />
      {actionError ? (
        <p className="mb-section text-[13px] text-[#a52f2f]" role="alert">
          {actionError}
        </p>
      ) : null}
      {editing ? (
        <section className="mb-section rounded-xl border border-border bg-surface p-5">
          <h2 className="mb-4 mt-0 text-xl font-semibold">Editar Series</h2>
          <SeriesForm
            initial={series}
            submitLabel="Guardar cambios"
            onSubmit={handleUpdate}
            onCancel={() => setEditing(false)}
          />
        </section>
      ) : null}
      <section className="grid gap-card md:grid-cols-2">
        <div className="rounded-xl border border-border bg-surface p-5">
          <span className="text-xs font-bold uppercase tracking-[0.08em] text-muted">
            Slug
          </span>
          <p className="mb-0 mt-2 font-semibold">{series.slug}</p>
        </div>
        <div className="rounded-xl border border-border bg-surface p-5">
          <span className="text-xs font-bold uppercase tracking-[0.08em] text-muted">
            Chapters
          </span>
          <p className="mb-0 mt-2">
            <Link
              className="font-semibold text-primary underline-offset-4 hover:underline"
              href={`/series/${series.id}/chapters`}
            >
              Abrir capítulos
            </Link>
          </p>
        </div>
      </section>
    </>
  );
}
