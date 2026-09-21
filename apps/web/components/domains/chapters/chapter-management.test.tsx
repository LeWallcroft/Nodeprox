import { readFileSync } from "node:fs";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { UploadQueueProvider } from "../../providers/upload-queue-provider";
import { EmptyState } from "../../ui/empty-state";
import { ErrorState } from "../../ui/error-state";
import { LoadingState } from "../../ui/loading-state";
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
  it("keeps the global Chapters master-detail contract and contextual actions", () => {
    const page = readFileSync(
      "apps/web/app/(dashboard)/chapters/page.tsx",
      "utf8",
    );

    expect(page).toContain("xl:grid-cols-[minmax(0,2fr)_minmax(320px,1fr)]");
    expect(page).toContain("Buscar capítulos...");
    expect(page).toContain('id="global-chapter-series-filter"');
    expect(page).toContain('id="global-chapter-status-filter"');
    expect(page).toContain("didInitializeSelection");
    expect(page).toContain("setSelectedChapterId(initialChapterId)");
    expect(page).toContain("Nuevo capítulo");
    expect(page).toContain("setUploading(true)");
    expect(page).toContain("onAssignCollaborator={() => setAssigning(true)}");
    expect(page).toContain("<AssignChapterCollaboratorDialog");
    expect(page).toContain("GlobalChapterCreateDialog");
    expect(page).toContain("GlobalChapterBulkUploadDialog");
    expect(page).not.toContain("h-52 overflow-y-auto");
    expect(page).not.toContain("proyección actual");
    expect(page).not.toContain('role === "admin"');
    expect(page).not.toContain('role === "gestor"');
  });

  it("uses the existing collaborator grant boundary for the selected Chapter", () => {
    const dialog = readFileSync(
      "apps/web/components/domains/chapters/assign-chapter-collaborator-dialog.tsx",
      "utf8",
    );

    expect(dialog).toContain("useHelperCandidates(chapterId, open)");
    expect(dialog).toContain("useGrantChapterHelper(chapterId)");
    expect(dialog).toContain("Asignar colaborador");
  });

  it("renders a selectable Chapter list with contract fields", () => {
    const markup = renderWithQueryClient(
      <ChapterList
        items={[{ ...chapter, imageCount: 0 }]}
        selectedId="chapter-25"
        onSelect={() => undefined}
        onQuickImages={() => undefined}
        seriesId="series-1"
      />,
    );
    expect(markup).toContain("25");
    expect(markup).toContain("Inicio");
    expect(markup).toContain('aria-pressed="true"');
    expect(markup).toContain('role="button"');
    expect(markup).toContain("cursor-pointer");
    expect(markup).toContain('aria-label="Enlaces de imágenes"');
    expect(markup).toContain('aria-label="Gestionar capítulo"');
    expect(
      readFileSync(
        "apps/web/components/domains/chapters/chapter-list.tsx",
        "utf8",
      ),
    ).toContain("hover:bg-surface-elevated");
  });

  it("keeps global Series titles readable while row actions stop selection propagation", () => {
    const page = readFileSync(
      "apps/web/app/(dashboard)/chapters/page.tsx",
      "utf8",
    );

    expect(page).toContain('tableClassName="min-w-0 table-fixed"');
    expect(page).toContain("line-clamp-2");
    expect(page).toContain("grid-rows-[2rem_1rem]");
    expect(page).toContain("max-w-[18rem] truncate");
    expect(page).toContain("stopTableRowSelection");
    expect(page).toContain("getSelectableTableRowProps");
    expect(page).not.toContain("MoreHorizontal");
  });

  it("keeps image links focused on copies and handles an empty public projection", () => {
    const dialog = readFileSync(
      "apps/web/components/domains/chapters/quick-chapter-images-dialog.tsx",
      "utf8",
    );
    const createDialog = readFileSync(
      "apps/web/components/domains/chapters/global-chapter-create-dialog.tsx",
      "utf8",
    );

    expect(dialog).toContain("Aún no hay imágenes disponibles");
    expect(dialog).not.toContain("Ver detalle");
    expect(createDialog).toContain('inputMode="decimal"');
    expect(createDialog).toContain('type="text"');
    expect(createDialog).not.toContain("normalizeChapterNumber");
  });

  it("uses replacement instead of a second ZIP upload when a Chapter already has images", () => {
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
    expect(markup).toContain("Cambiar capítulo");
    expect(markup).toContain("Este capítulo ya contiene imágenes");
    expect(markup).not.toContain("Subir ZIP");
    expect(markup).toContain("Gestionar capítulo");
    expect(markup).not.toContain("Publicación e imágenes");
    expect(markup).toContain("bg-destructive-surface");
  });

  it("keeps direct ZIP upload available before a Chapter has images", () => {
    const markup = renderWithQueryClient(
      <ChapterDetailPanel
        chapter={{ ...chapter, status: "draft" }}
        capabilities={["images.upload"]}
        onClose={() => undefined}
        onUpdate={async () => undefined}
        onDelete={async () => undefined}
      />,
    );
    expect(markup).toContain("Subir ZIP");
    expect(markup).not.toContain("Cambiar capítulo");
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
    expect(markup).toContain("Arrastra un ZIP aquí");
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
    expect(markup).toContain("Arrastra uno o varios ZIP aquí");
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
    const bulkDialog = readFileSync(
      "apps/web/components/domains/chapters/bulk-chapter-upload-dialog.tsx",
      "utf8",
    );
    expect(bulkDialog).toContain('useChapterList(open ? seriesId : "")');
    expect(bulkDialog).toContain("Usa Cambiar capítulo");
    expect(bulkDialog).toContain("preflightConflictLabel");
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
