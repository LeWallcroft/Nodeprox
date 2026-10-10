import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { UserUploadPolicy } from "../../../lib/domains/uploads/upload-policy";
import { UploadRequirements } from "./upload-requirements";

const policy: UserUploadPolicy = {
  zip: {
    maxUploadBytes: 512 * 1024 * 1024,
    maxEntries: 1000,
    maxExpandedBytes: 512 * 1024 * 1024,
    layouts: ["flat", "single-wrapper"],
  },
  images: {
    allowedExtensions: ["jpg", "jpeg", "png", "webp", "gif"],
    filenameRule: "two-digit-sequence",
    maxImageBytes: 64 * 1024 * 1024,
    maxWidthPx: null,
    maxHeightPx: 15000,
    maxPixels: null,
    maxCompressionRatio: null,
  },
  warnings: {
    imageBytes: 8 * 1024 * 1024,
    widthPx: 4000,
    heightPx: 12000,
  },
  transfer: { maxConcurrentUploads: 3 },
};

describe("UploadRequirements", () => {
  it("starts collapsed with an accessible disclosure control", () => {
    const markup = renderToStaticMarkup(<UploadRequirements policy={policy} />);
    expect(markup).toContain('aria-expanded="false"');
    expect(markup).toContain("aria-controls=");
    expect(markup).toContain("Requisitos para la carga");
    expect(markup).not.toContain("Límites obligatorios");
  });

  it("separates hard limits from non-blocking warnings when expanded", () => {
    const markup = renderToStaticMarkup(
      <UploadRequirements policy={policy} defaultOpen />,
    );
    expect(markup).toContain('aria-expanded="true"');
    expect(markup).toContain("Estructura");
    expect(markup).toContain("JPG · JPEG · PNG · WEBP · GIF");
    expect(markup).toContain("Máximo permitido por imagen");
    expect(markup).toContain("Altura máxima permitida");
    expect(markup).toContain("Advertencias");
    expect(markup).toContain("No bloquean la carga");
    expect(markup).toContain("Cargas ZIP simultáneas");
    expect(markup).toContain("bg-success/10 text-success");
    expect(markup).toContain("bg-warning/10 text-warning");
    expect(markup).not.toContain("divide-y");
    expect(markup).not.toContain("border-b");
  });

  it("shows loading and recoverable error states", () => {
    expect(
      renderToStaticMarkup(
        <UploadRequirements policy={null} loading defaultOpen />,
      ),
    ).toContain("Cargando requisitos");
    const errorMarkup = renderToStaticMarkup(
      <UploadRequirements
        policy={null}
        error
        defaultOpen
        onRetry={() => undefined}
      />,
    );
    expect(errorMarkup).toContain("No se pudieron cargar los requisitos");
    expect(errorMarkup).toContain("Reintentar");
  });
});
