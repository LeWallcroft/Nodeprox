"use client";

import Link from "next/link";
import { useState } from "react";
import { PageHeader } from "../../../components/layout/page-header";
import { SeriesForm } from "../../../components/domains/series/series-form";
import { errorMessage } from "../../../components/domains/feedback";
import { Button } from "../../../components/ui/button";
import { DataTable } from "../../../components/ui/data-table";
import { EmptyState } from "../../../components/ui/empty-state";
import { ErrorState } from "../../../components/ui/error-state";
import { Skeleton } from "../../../components/ui/skeleton";
import {
  useCreateSeries,
  useSeriesList,
} from "../../../lib/domains/series/hooks";
import type { SeriesInput } from "../../../lib/domains/series/types";

export default function SeriesPage() {
  const query = useSeriesList();
  const create = useCreateSeries();
  const [creating, setCreating] = useState(false);

  async function handleCreate(input: SeriesInput) {
    await create.mutateAsync(input);
    setCreating(false);
  }

  return (
    <>
      <PageHeader
        title="Series"
        description="Administra las series disponibles para tu workspace."
        breadcrumbs={[
          { label: "Dashboard", href: "/" },
          { label: "Series", current: true },
        ]}
        actions={
          <Button type="button" onClick={() => setCreating((value) => !value)}>
            {creating ? "Cerrar" : "Nueva Series"}
          </Button>
        }
      />
      {creating ? (
        <section
          className="mb-section rounded-xl border border-border bg-surface p-5"
          aria-labelledby="create-series-title"
        >
          <h2
            id="create-series-title"
            className="mb-4 mt-0 text-xl font-semibold"
          >
            Crear Series
          </h2>
          <SeriesForm
            onSubmit={handleCreate}
            onCancel={() => setCreating(false)}
          />
        </section>
      ) : null}
      {query.isPending ? (
        <section className="grid gap-3 rounded-xl border border-border bg-surface p-5">
          <Skeleton />
          <Skeleton />
          <Skeleton />
        </section>
      ) : null}
      {query.isError ? (
        <ErrorState
          title="No se pudieron cargar las Series"
          description={errorMessage(query.error)}
          action={
            <Button type="button" onClick={() => void query.refetch()}>
              Reintentar
            </Button>
          }
        />
      ) : null}
      {query.isSuccess && query.data.length === 0 ? (
        <EmptyState
          title="No hay Series todavía"
          description="Crea la primera Series para comenzar."
        />
      ) : null}
      {query.isSuccess && query.data.length > 0 ? (
        <DataTable label="Series">
          <thead>
            <tr className="border-b border-border text-left text-sm text-muted">
              <th className="p-3">Título</th>
              <th className="p-3">Slug</th>
              <th className="p-3">Descripción</th>
            </tr>
          </thead>
          <tbody>
            {query.data.map((series) => (
              <tr
                className="border-b border-border last:border-0"
                key={series.id}
              >
                <td className="p-3 font-semibold">
                  <Link
                    className="text-primary underline-offset-4 hover:underline"
                    href={`/series/${series.id}`}
                  >
                    {series.title}
                  </Link>
                </td>
                <td className="p-3 text-muted">{series.slug}</td>
                <td className="p-3 text-muted">{series.description || "—"}</td>
              </tr>
            ))}
          </tbody>
        </DataTable>
      ) : null}
    </>
  );
}
