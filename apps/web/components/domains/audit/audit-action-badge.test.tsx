import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import {
  AuditActionBadge,
  auditActionPresentation,
} from "./audit-action-badge";

describe("AuditActionBadge", () => {
  it("derives compact labels from real action codes with a neutral fallback", () => {
    expect(auditActionPresentation("chapter.upload.initiated").label).toBe(
      "Carga iniciada",
    );
    expect(auditActionPresentation("chapter.upload.completed").label).toBe(
      "Carga completada",
    );
    expect(auditActionPresentation("chapter.upload.aborted").label).toBe(
      "Carga cancelada",
    );
    expect(auditActionPresentation("chapter.uploaded").label).toBe("Subir");
    expect(auditActionPresentation("series.deleted").label).toBe("Eliminar");
    expect(auditActionPresentation("chapter.permission.granted").label).toBe(
      "Autorización",
    );
    expect(auditActionPresentation("unmapped.event").label).toBe(
      "unmapped.event",
    );
    expect(auditActionPresentation("chapter.processing.completed").label).toBe(
      "Procesar",
    );
  });

  it("renders the presentation with a semantic status badge", () => {
    const markup = renderToStaticMarkup(
      <AuditActionBadge action="series.created" />,
    );
    expect(markup).toContain("Crear");
    expect(markup).toContain("bg-success-soft");
  });
});
