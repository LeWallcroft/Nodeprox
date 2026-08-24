"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useState } from "react";
import { PageHeader } from "../../../../../components/layout/page-header";
import { errorMessage } from "../../../../../components/domains/feedback";
import { ChapterForm } from "../../../../../components/domains/chapters/chapter-form";
import { Button } from "../../../../../components/ui/button";
import { DataTable } from "../../../../../components/ui/data-table";
import { EmptyState } from "../../../../../components/ui/empty-state";
import { ErrorState } from "../../../../../components/ui/error-state";
import { Skeleton } from "../../../../../components/ui/skeleton";
import { StatusBadge } from "../../../../../components/ui/status-badge";
import {
  useChapterList,
  useCreateChapter,
} from "../../../../../lib/domains/chapters/hooks";
import { useSeries } from "../../../../../lib/domains/series/hooks";

export default function SeriesChaptersPage() {
  const params = useParams<{ seriesId: string }>();
  const seriesId = params.seriesId;
  const seriesQuery = useSeries(seriesId);
  const query = useChapterList(seriesId);
  const create = useCreateChapter(seriesId);
  const [creating, setCreating] = useState(false);

  return (
    <>
      <PageHeader
        title={
          seriesQuery.data?.title
            ? `Chapters — ${seriesQuery.data.title}`
            : "Chapters"
        }
        description="Gestiona los capítulos de la Series."
        breadcrumbs={[
          { label: "Dashboard", href: "/" },
          { label: "Series", href: "/series" },
          { label: "Chapters", current: true },
        ]}
        actions={
          <Button type="button" onClick={() => setCreating((value) => !value)}>
            {creating ? "Cerrar" : "Nuevo Chapter"}
          </Button>
        }
      />
      {creating ? (
        <section className="mb-section rounded-xl border border-border bg-surface p-5">
          <h2 className="mb-4 mt-0 text-xl font-semibold">Crear Chapter</h2>
          <ChapterForm
            onSubmit={async (input) => {
              await create.mutateAsync(input);
              setCreating(false);
            }}
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
          title="No se pudieron cargar los Chapters"
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
          title="No hay Chapters todavía"
          description="Crea el primer capítulo de esta Series."
        />
      ) : null}
      {query.isSuccess && query.data.length > 0 ? (
        <DataTable label="Chapters">
          <thead>
            <tr className="border-b border-border text-left text-sm text-muted">
              <th className="p-3">Número</th>
              <th className="p-3">Título</th>
              <th className="p-3">Estado</th>
            </tr>
          </thead>
          <tbody>
            {query.data.map((chapter) => (
              <tr
                className="border-b border-border last:border-0"
                key={chapter.id}
              >
                <td className="p-3 font-semibold">
                  <Link
                    className="text-primary underline-offset-4 hover:underline"
                    href={`/chapters/${chapter.id}`}
                  >
                    {chapter.chapterNumber}
                  </Link>
                </td>
                <td className="p-3">{chapter.title || "—"}</td>
                <td className="p-3">
                  <StatusBadge
                    label={chapter.status}
                    tone={
                      chapter.status === "ready"
                        ? "success"
                        : chapter.status === "failed"
                          ? "danger"
                          : chapter.status === "processing"
                            ? "warning"
                            : "neutral"
                    }
                  />
                </td>
              </tr>
            ))}
          </tbody>
        </DataTable>
      ) : null}
    </>
  );
}
