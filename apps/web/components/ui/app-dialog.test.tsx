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
