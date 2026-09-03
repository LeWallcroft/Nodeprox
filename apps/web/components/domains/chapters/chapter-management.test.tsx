import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { EmptyState } from "../../ui/empty-state";
import { ErrorState } from "../../ui/error-state";
import { LoadingState } from "../../ui/loading-state";
import { UploadQueueProvider } from "../../providers/upload-queue-provider";
import { UploadForm } from "../uploads/upload-form";
import {
  BulkChapterUploadDialog,
  importErrorLabel,
  resolutionLabel,
} from "./bulk-chapter-upload-dialog";
import { ChapterDetailPanel } from "./chapter-detail-panel";
import { ChapterForm } from "./chapter-form";
import { ChapterList } from "./chapter-list";

const chapter = {
  id: "chapter-25",
  seriesId: "series-1",
  chapterNumber: 25,
  publicKey: "25",
  title: "Inicio",
  status: "ready" as const,
  createdBy: "user-1",
  createdAt: "2026-08-01T00:00:00.000Z",
  updatedAt: "2026-08-02T00:00:00.000Z",
};

function renderWithQueryClient(element: ReactNode) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return renderToStaticMarkup(
    <QueryClientProvider client={queryClient}>
      <UploadQueueProvider>{element}</UploadQueueProvider>
    </QueryClientProvider>,
  );
}

describe("Chapter management presentation", () => {
  it("renders a selectable Chapter list with contract fields", () => {
    const markup = renderWithQueryClient(
      <ChapterList
        items={[{ ...chapter }]}
        selectedId="chapter-25"
        onSelect={() => undefined}
        onQuickImages={() => undefined}
      />,
    );
    expect(markup).toContain("25");
    expect(markup).toContain("Inicio");
    expect(markup).toContain('aria-pressed="true"');
    expect(markup).toContain('aria-label="Vista rápida de imágenes"');
    expect(markup).toContain('title="Vista rápida de imágenes"');
  });

  it("uses contextual capabilities for Chapter actions and direct upload", () => {
    const markup = renderWithQueryClient(
      <ChapterDetailPanel
        chapter={chapter}
        capabilities={["chapters.edit", "chapters.delete", "images.upload"]}
        onClose={() => undefined}
        onUpdate={async () => undefined}
        onDelete={async () => undefined}
      />,
    );
    expect(markup).toContain("Editar capítulo");
    expect(markup).toContain("Eliminar capítulo");
    expect(markup).toContain("Subir ZIP");
    expect(markup).toContain("Gestionar imágenes");
    expect(markup).not.toContain("Publicación e imágenes");
    expect(markup).toContain("bg-destructive-surface");
  });

  it("hides contextual actions when the capability projection omits them", () => {
    const markup = renderWithQueryClient(
      <ChapterDetailPanel
        chapter={chapter}
        capabilities={["chapters.read"]}
        onClose={() => undefined}
        onUpdate={async () => undefined}
        onDelete={async () => undefined}
      />,
    );
    expect(markup).not.toContain("Editar capítulo");
    expect(markup).not.toContain("Eliminar capítulo");
    expect(markup).not.toContain("Upload ZIP");
  });

  it("keeps the stable public key out of Chapter editing", () => {
    const markup = renderToStaticMarkup(
      <ChapterForm
        initial={chapter}
        editableNumber={false}
        onSubmit={async () => undefined}
      />,
    );
    expect(markup).not.toContain("chapter-number");
    expect(markup).not.toContain("publicKey");
    expect(markup).not.toContain("Clave pública");
  });

  it("uses the custom hidden ZIP picker for direct Chapter uploads", () => {
    const markup = renderWithQueryClient(
      <UploadForm seriesId="series-1" chapterId="chapter-25" />,
    );
    expect(markup).toContain('type="file"');
    expect(markup).toContain("sr-only");
    expect(markup).toContain("Arrastra tu ZIP aquí");
    expect(markup).toContain("Subir ZIP");
  });

  it("uses one modal for one or many direct ZIP uploads without a wizard", () => {
    const markup = renderWithQueryClient(
      <BulkChapterUploadDialog
        open
        onOpenChange={() => undefined}
        seriesId="series-1"
        seriesTitle="Serie"
      />,
    );
    expect(markup).toContain("Subir capítulos");
    expect(markup).toContain("Seleccionar archivos ZIP");
    expect(markup).toContain('type="file"');
    expect(markup).toContain("multiple");
    expect(markup).not.toContain("Continuar con ZIP");
  });

  it("presents Smart Bulk target resolutions and typed conflicts", () => {
    expect(resolutionLabel("created")).toBe("Capítulo creado");
    expect(resolutionLabel("reused")).toBe("Capítulo reutilizado");
    expect(resolutionLabel("conflict")).toBe("Conflicto de capítulo");
    expect(importErrorLabel("chapter-processing")).toBe(
      "El capítulo se está procesando.",
    );
    expect(importErrorLabel("chapter-ready")).toBe(
      "El capítulo ya está listo.",
    );
  });

  it("renders the shared loading, empty and error states", () => {
    expect(renderToStaticMarkup(<LoadingState />)).toContain("Cargando");
    expect(
      renderToStaticMarkup(
        <EmptyState title="Vacío" description="Sin Chapters" />,
      ),
    ).toContain("Vacío");
    expect(renderToStaticMarkup(<ErrorState description="Falló" />)).toContain(
      "Falló",
    );
  });
});
