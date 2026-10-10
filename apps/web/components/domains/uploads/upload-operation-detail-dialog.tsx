"use client";

import type { MediaWarning } from "@nodeprox/types";
import { useCallback, useEffect, useState } from "react";
import {
  getUploadValidationReport,
  type UploadValidationReport,
} from "../../../lib/domains/uploads/background-operations";
import type { UploadCenterRecord } from "../../../lib/domains/uploads/upload-center-view-model";
import { AppDialog } from "../../ui/app-dialog";

export function UploadOperationDetailDialog({
  open,
  operation,
  onOpenChange,
}: {
  open: boolean;
  operation: UploadCenterRecord | null;
  onOpenChange(open: boolean): void;
}) {
  const [state, setState] = useState<"loading" | "loaded" | "error">("loading");
  const [report, setReport] = useState<UploadValidationReport | null>(null);
  const operationId = operation?.id;
  const kind = operation?.kind;
  const supportsReport = Boolean(
    operation && operation.kind !== "image_replacement",
  );
  const load = useCallback(async () => {
    if (!operationId || !kind || kind === "image_replacement") return;
    setState("loading");
    try {
      const result = await getUploadValidationReport(kind, operationId);
      setReport(result);
      setState("loaded");
    } catch {
      setReport(null);
      setState("error");
    }
  }, [kind, operationId]);

  useEffect(() => {
    if (!open) return;
    setReport(null);
    if (kind === "image_replacement" || !operationId) {
      setState("loaded");
      return;
    }
    void load();
  }, [kind, load, open, operationId]);

  const title = operation ? operationTitle(operation) : "Detalle de carga";
  return (
    <AppDialog open={open} onOpenChange={onOpenChange} title={title} size="lg">
      {!operation ? null : (
        <div className="space-y-4 text-sm text-secondary">
          <div className="rounded-control border border-[var(--border-subtle)] bg-surface p-3">
            <p className="m-0 font-medium text-text">
              {statusLabel(operation.status)}
            </p>
            <p className="m-0 mt-1">{operation.filename}</p>
            {operation.errorCode ? (
              <p className="m-0 mt-1 text-destructive-text">
                {safeErrorLabel(operation.errorCode)}
              </p>
            ) : null}
            {operation.failureStage ? (
              <p className="m-0 mt-1">Etapa: {operation.failureStage}</p>
            ) : null}
          </div>
          {operation.kind === "image_replacement" ? null : state ===
            "loading" ? (
            <p role="status">Cargando detalle…</p>
          ) : state === "error" ? (
            <div role="alert">
              <p>No se pudo cargar el detalle.</p>
              <button
                className="underline"
                type="button"
                onClick={() => void load()}
              >
                Reintentar detalle
              </button>
            </div>
          ) : supportsReport ? (
            <ValidationDetails operation={operation} report={report} />
          ) : null}
          <div className="border-t border-[var(--border-subtle)] pt-3 text-xs">
            {report?.requestId ? (
              <p className="m-0">Request ID: {report.requestId}</p>
            ) : null}
            <p className="m-0 mt-1">Operation ID: {operation.id}</p>
          </div>
        </div>
      )}
    </AppDialog>
  );
}

function ValidationDetails({
  operation,
  report,
}: {
  operation: UploadCenterRecord;
  report: UploadValidationReport | null;
}) {
  if (!report) return null;
  const issues = groupByFilename(
    report.issues,
    (issue) =>
      issue.filename ??
      (issue.fileIndex ? `Archivo ${issue.fileIndex}` : operation.filename),
  );
  const warnings = groupByFilename(
    report.warnings,
    (warning) => warning.filename,
  );
  return (
    <div className="space-y-4">
      {issues.map(([filename, items]) => (
        <section
          key={`issue-${filename}`}
          className="rounded-control border border-destructive/30 bg-destructive-surface p-3"
        >
          <h3 className="m-0 font-semibold text-text">{filename}</h3>
          {items.map((issue) => {
            const measurement = validationIssueMeasurement(issue);
            return (
              <div key={issue.id} className="mt-2">
                <p className="m-0 font-medium text-text">
                  {validationIssueLabel(issue.code)}
                </p>
                {measurement.actual ? (
                  <p className="m-0 mt-1">Actual: {measurement.actual}</p>
                ) : null}
                {measurement.expected ? (
                  <p className="m-0">Máximo: {measurement.expected}</p>
                ) : null}
                <p className="m-0 mt-1 text-xs">Código: {issue.code}</p>
              </div>
            );
          })}
        </section>
      ))}
      {warnings.map(([filename, items]) => (
        <section
          key={`warning-${filename}`}
          className="rounded-control border border-warning/30 bg-warning/5 p-3"
        >
          <h3 className="m-0 font-semibold text-text">{filename}</h3>
          {items.map((warning) => {
            const detail = mediaWarningPresentation(warning);
            return (
              <div
                key={`${warning.code}-${warning.filename}-${JSON.stringify(warning)}`}
                className="mt-2"
              >
                <p className="m-0 font-medium text-text">{detail.title}</p>
                <p className="m-0 mt-1">Actual: {detail.actual}</p>
                {detail.threshold ? (
                  <p className="m-0">Umbral recomendado: {detail.threshold}</p>
                ) : null}
              </div>
            );
          })}
        </section>
      ))}
      {!issues.length && !warnings.length ? (
        <p className="m-0">No hay detalles de validación para mostrar.</p>
      ) : null}
    </div>
  );
}

function groupByFilename<T>(
  items: readonly T[],
  filename: (item: T) => string,
) {
  const groups = new Map<string, T[]>();
  for (const item of items) {
    const key = filename(item);
    groups.set(key, [...(groups.get(key) ?? []), item]);
  }
  return [...groups.entries()];
}

export function mediaWarningPresentation(warning: MediaWarning) {
  switch (warning.code) {
    case "large-file":
      return {
        title: "Archivo grande",
        actual: formatMiB(warning.sizeBytes),
        ...(warning.thresholdBytes === undefined
          ? {}
          : { threshold: formatMiB(warning.thresholdBytes) }),
      };
    case "wide-image":
      return {
        title: "Imagen muy ancha",
        actual: `${formatInteger(warning.width)} px`,
        ...(warning.thresholdWidth === undefined
          ? {}
          : { threshold: `${formatInteger(warning.thresholdWidth)} px` }),
      };
    case "tall-image":
      return {
        title: "Imagen muy alta",
        actual: `${formatInteger(warning.height)} px`,
        ...(warning.thresholdHeight === undefined
          ? {}
          : { threshold: `${formatInteger(warning.thresholdHeight)} px` }),
      };
  }
}

export function validationIssueMeasurement(issue: {
  code: string;
  actual?: Record<string, unknown> | null;
  expected?: Record<string, unknown> | null;
}) {
  const actual = issue.actual ?? {};
  const expected = issue.expected ?? {};
  const read = (source: Record<string, unknown>, ...keys: string[]) =>
    keys
      .map((key) => source[key])
      .find(
        (value): value is number =>
          typeof value === "number" && Number.isFinite(value),
      );
  let actualValue: number | undefined;
  let expectedValue: number | undefined;
  let format: (value: number) => string;
  switch (issue.code) {
    case "IMAGE_SIZE_EXCEEDED":
      actualValue = read(actual, "sizeBytes");
      expectedValue = read(expected, "maxImageBytes", "maxSizeBytes");
      format = formatMiB;
      break;
    case "IMAGE_WIDTH_EXCEEDED":
      actualValue = read(actual, "widthPx", "width");
      expectedValue = read(expected, "maxWidthPx", "widthPx");
      format = (value) => `${formatInteger(value)} px`;
      break;
    case "IMAGE_HEIGHT_EXCEEDED":
      actualValue = read(actual, "heightPx", "height");
      expectedValue = read(expected, "maxHeightPx", "heightPx");
      format = (value) => `${formatInteger(value)} px`;
      break;
    case "IMAGE_PIXELS_EXCEEDED":
      actualValue = read(actual, "pixels");
      expectedValue = read(expected, "maxPixels");
      format = formatInteger;
      break;
    case "ZIP_COMPRESSION_RATIO_EXCEEDED":
      actualValue = read(actual, "compressionRatio", "ratio");
      expectedValue = read(expected, "maxCompressionRatio");
      format = (value) =>
        `${new Intl.NumberFormat("es-PE", { maximumFractionDigits: 1 }).format(value)}×`;
      break;
    default:
      return {};
  }
  return {
    ...(actualValue === undefined ? {} : { actual: format(actualValue) }),
    ...(expectedValue === undefined ? {} : { expected: format(expectedValue) }),
  };
}

function formatMiB(bytes: number) {
  return `${(bytes / (1024 * 1024)).toFixed(1).replace(/\.0$/, "")} MB`;
}
function formatInteger(value: number) {
  return new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 })
    .format(value)
    .replace(/,/g, " ");
}
function operationTitle(operation: UploadCenterRecord) {
  return `${operation.status === "rejected" ? "Carga rechazada" : "Detalle de carga"}${operation.chapterNumber === null ? "" : ` · Capítulo ${operation.chapterNumber}`}`;
}
function statusLabel(status: string) {
  return (
    (
      {
        ready: "Completada",
        completed: "Completada",
        rejected: "Carga rechazada",
        retry_exhausted: "Requiere atención",
        terminal_failed: "Error permanente",
        failed: "Error",
        validating: "Validando archivo",
        processing: "Procesando",
      } as Record<string, string>
    )[status] ?? status
  );
}
function safeErrorLabel(code: string) {
  return code.replace(/[^a-zA-Z0-9_-]/g, "").slice(0, 80);
}
function validationIssueLabel(code: string) {
  return (
    (
      {
        IMAGE_HEIGHT_EXCEEDED: "Imagen demasiado alta",
        IMAGE_WIDTH_EXCEEDED: "Imagen demasiado ancha",
        IMAGE_SIZE_EXCEEDED: "Tamaño de imagen excedido",
        IMAGE_PIXELS_EXCEEDED: "Demasiados píxeles",
        ZIP_INVALID: "ZIP inválido",
        ZIP_INVALID_PATH: "Ruta no permitida",
        ZIP_INVALID_LAYOUT: "Estructura inválida",
        IMAGE_FILENAME_INVALID: "Nombre de imagen inválido",
        IMAGE_MAGIC_MISMATCH: "Contenido incompatible con la extensión",
      } as Record<string, string>
    )[code] ?? "Validación no superada"
  );
}
