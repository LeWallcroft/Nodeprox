"use client";

import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useState } from "react";
import { PageHeader } from "../../../../components/layout/page-header";
import { ChapterForm } from "../../../../components/domains/chapters/chapter-form";
import { ChapterPublicationSection } from "../../../../components/domains/publication/chapter-publication-section";
import { UploadForm } from "../../../../components/domains/uploads/upload-form";
import { errorMessage } from "../../../../components/domains/feedback";
import { Button } from "../../../../components/ui/button";
import { EmptyState } from "../../../../components/ui/empty-state";
import { ErrorState } from "../../../../components/ui/error-state";
import { Skeleton } from "../../../../components/ui/skeleton";
import { StatusBadge } from "../../../../components/ui/status-badge";
import {
  useChapter,
  useDeleteChapter,
  useUpdateChapter,
} from "../../../../lib/domains/chapters/hooks";

export default function ChapterDetailPage() {
  const params = useParams<{ chapterId: string }>();
  const router = useRouter();
  const chapterId = params.chapterId;
  const query = useChapter(chapterId);
  const [editing, setEditing] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const chapter = query.data;
  const update = useUpdateChapter(chapterId, chapter?.seriesId ?? "");
  const remove = useDeleteChapter(chapter?.seriesId ?? "");

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
        title="No se pudo cargar el Chapter"
        description={errorMessage(query.error)}
        action={
          <Button type="button" onClick={() => void query.refetch()}>
            Reintentar
          </Button>
        }
      />
    );
  if (!chapter)
    return (
      <EmptyState
        title="Chapter no encontrado"
        description="El Chapter solicitado ya no está disponible."
      />
    );
  const currentChapter = chapter;

  async function deleteCurrent() {
    if (!window.confirm("¿Eliminar este Chapter?")) return;
    setActionError(null);
    try {
      await remove.mutateAsync(chapterId);
      router.push(`/series/${currentChapter.seriesId}/chapters`);
    } catch (cause) {
      setActionError(errorMessage(cause));
    }
  }

  return (
    <>
      <PageHeader
        title={`Chapter ${currentChapter.chapterNumber}`}
        description={currentChapter.title || "Sin título."}
        breadcrumbs={[
          { label: "Dashboard", href: "/" },
          { label: "Series", href: "/series" },
          {
            label: "Chapters",
            href: `/series/${currentChapter.seriesId}/chapters`,
          },
          { label: `Chapter ${currentChapter.chapterNumber}`, current: true },
        ]}
        actions={
          <div className="flex gap-2">
            <Button type="button" onClick={() => setEditing((value) => !value)}>
              {editing ? "Cerrar edición" : "Editar"}
            </Button>
            <button
              className="inline-flex min-h-control items-center justify-center rounded-lg border border-[#a52f2f] bg-surface px-3.5 font-semibold text-[#a52f2f]"
              type="button"
              onClick={() => void deleteCurrent()}
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
          <h2 className="mb-4 mt-0 text-xl font-semibold">Editar Chapter</h2>
          <ChapterForm
            initial={currentChapter}
            submitLabel="Guardar cambios"
            onSubmit={async (input) => {
              await update.mutateAsync(input);
              setEditing(false);
            }}
            onCancel={() => setEditing(false)}
          />
        </section>
      ) : null}
      <section className="mb-section grid gap-card md:grid-cols-3">
        <div className="rounded-xl border border-border bg-surface p-5">
          <span className="text-xs font-bold uppercase tracking-[0.08em] text-muted">
            Estado
          </span>
          <div className="mt-2">
            <StatusBadge
              label={currentChapter.status}
              tone={
                currentChapter.status === "ready"
                  ? "success"
                  : currentChapter.status === "failed"
                    ? "danger"
                    : currentChapter.status === "processing"
                      ? "warning"
                      : "neutral"
              }
            />
          </div>
        </div>
        <div className="rounded-xl border border-border bg-surface p-5">
          <span className="text-xs font-bold uppercase tracking-[0.08em] text-muted">
            Actualizado
          </span>
          <p className="mb-0 mt-2 text-sm text-muted">
            {new Date(currentChapter.updatedAt).toLocaleString("es-PE")}
          </p>
        </div>
        <div className="rounded-xl border border-border bg-surface p-5">
          <span className="text-xs font-bold uppercase tracking-[0.08em] text-muted">
            Series
          </span>
          <p className="mb-0 mt-2">
            <Link
              className="font-semibold text-primary underline-offset-4 hover:underline"
              href={`/series/${currentChapter.seriesId}`}
            >
              Ver Series
            </Link>
          </p>
        </div>
      </section>
      {currentChapter.status === "failed" ? (
        <ErrorState
          title="Procesamiento fallido"
          description="El backend reportó que el procesamiento no pudo completarse."
        />
      ) : null}
      {currentChapter.status === "ready" ? (
        <section
          className="mb-section rounded-xl border border-border bg-surface p-5"
          role="status"
        >
          <h2 className="mt-0 text-xl font-semibold">Procesamiento listo</h2>
          <p className="mb-0 text-muted">
            El Chapter está listo para publicación.
          </p>
        </section>
      ) : null}
      <ChapterPublicationSection
        chapterId={currentChapter.id}
        chapterStatus={currentChapter.status}
      />
      <section
        className="rounded-xl border border-border bg-surface p-5"
        aria-labelledby="upload-title"
      >
        <h2 id="upload-title" className="mb-4 mt-0 text-xl font-semibold">
          Upload ZIP
        </h2>
        <UploadForm
          seriesId={currentChapter.seriesId}
          chapterId={currentChapter.id}
        />
      </section>
    </>
  );
}
