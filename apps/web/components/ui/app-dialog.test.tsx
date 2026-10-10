import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { AppDialog } from "./app-dialog";
import { ConfirmationDialog } from "./confirmation-dialog";

describe("AppDialog", () => {
  it("renders one accessible shared modal surface", () => {
    const markup = renderToStaticMarkup(
      <AppDialog
        open
        title="Editar serie"
        description="Actualiza datos visibles."
        onOpenChange={() => undefined}
      >
        <input aria-label="Nombre" />
      </AppDialog>,
    );
    expect(markup).toContain('role="dialog"');
    expect(markup).toContain('aria-modal="true"');
    expect(markup).toContain("backdrop-blur-sm");
    expect(markup).toContain("Editar serie");
    expect(markup).toContain('aria-label="Cerrar diálogo"');
    expect(markup).toContain("max-w-[620px]");
    expect(markup).toContain("border-b border-[var(--border-subtle)]");
  });

  it("supports soft chrome and fixed compact geometry without changing defaults", () => {
    const markup = renderToStaticMarkup(
      <AppDialog
        open
        title="Resultado"
        chrome="soft"
        geometry="compact-stable"
        footer={<button type="button">Cerrar</button>}
        onOpenChange={() => undefined}
      >
        Contenido
      </AppDialog>,
    );
    expect(markup).toContain("max-w-[560px]");
    expect(markup).toContain("h-[min(26.25rem,calc(100dvh-3rem))]");
    expect(markup).not.toContain("border-b border-[var(--border-subtle)]");
    expect(markup).not.toContain("border-t border-[var(--border-subtle)]");
    expect(markup).toContain("min-h-[4.5rem]");
  });

  it("supports a stable workspace geometry with a soft header", () => {
    const markup = renderToStaticMarkup(
      <AppDialog
        open
        title="Detalle"
        chrome="soft"
        geometry="workspace-stable"
        onOpenChange={() => undefined}
      >
        Detalle
      </AppDialog>,
    );
    expect(markup).toContain("max-w-[760px]");
    expect(markup).toContain("h-[min(42rem,calc(100dvh-3rem))]");
    expect(markup).not.toContain("border-b border-[var(--border-subtle)]");
  });

  it("uses the shared primitive for destructive confirmations", () => {
    const markup = renderToStaticMarkup(
      <ConfirmationDialog
        confirmLabel="Eliminar serie"
        description="No se puede deshacer."
        open
        title="¿Eliminar serie?"
        onConfirm={() => undefined}
        onOpenChange={() => undefined}
      />,
    );
    expect(markup).toContain('role="dialog"');
    expect(markup).toContain("Eliminar serie");
    expect(markup).toContain("bg-destructive-surface");
  });
});
