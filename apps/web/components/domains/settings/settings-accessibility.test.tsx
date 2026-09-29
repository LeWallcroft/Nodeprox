import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { ProductSettingField } from "../../../lib/domains/settings/types";
import { ConfirmationDialog } from "../../ui/confirmation-dialog";
import { SettingField } from "./setting-field";

const field: ProductSettingField = {
  key: "bulk_upload_concurrency",
  label: "Subidas ZIP simultáneas",
  description: "Carga de navegador.",
  unit: "cargas",
  helpText: "Máximo de cargas directas simultáneas.",
  impact: "Puede incrementar el uso de red.",
  type: "number",
  value: 2,
  editable: true,
  constraints: { min: 1, max: 5 },
};

describe("Settings accessibility contracts", () => {
  it("connects field label, description, and validation error while retaining focus-visible styling", () => {
    const markup = renderToStaticMarkup(
      <SettingField
        field={field}
        value="8"
        error="El valor máximo es 5."
        onChange={() => undefined}
      />,
    );
    expect(markup).toContain('for="setting-bulk_upload_concurrency"');
    expect(markup).toContain('id="setting-bulk_upload_concurrency"');
    expect(markup).toContain('aria-invalid="true"');
    expect(markup).toContain(
      'aria-describedby="setting-bulk_upload_concurrency-description setting-bulk_upload_concurrency-error"',
    );
    expect(markup).toContain("focus-visible:outline");
    expect(markup).toContain("border-danger");
  });

  it("explains activation consequences in the shared keyboard-accessible dialog", () => {
    const markup = renderToStaticMarkup(
      <ConfirmationDialog
        open
        title="Usar este perfil para trabajo nuevo"
        description="Este perfil se usará únicamente para trabajo nuevo. Los archivos existentes permanecen en su almacenamiento actual y no se moverán ni copiarán."
        confirmLabel="Usar para cargas nuevas"
        onConfirm={() => undefined}
        onOpenChange={() => undefined}
      />,
    );
    expect(markup).toContain('role="dialog"');
    expect(markup).toContain(
      "Los archivos existentes permanecen en su almacenamiento actual",
    );
    expect(markup).toContain("Usar para cargas nuevas");
  });
});
