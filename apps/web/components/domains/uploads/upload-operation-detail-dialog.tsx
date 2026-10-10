"use client";

import type { MediaWarning } from "@nodeprox/types";
import { type ReactNode, useCallback, useEffect, useState } from "react";
import {
  getUploadValidationReport,
  type UploadValidationReport,
} from "../../../lib/domains/uploads/background-operations";
import {
  canLoadValidationReport,
  type UploadCenterRecord,
} from "../../../lib/domains/uploads/upload-center-view-model";
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
  const [activeTab, setActiveTab] = useState<
    "warnings" | "errors" | "information"
  >("warnings");
  const [report, setReport] = useState<UploadValidationReport | null>(null);
  const operationId = operation?.id;
  const kind = operation?.kind;
  const supportsReport = Boolean(
    operation && canLoadValidationReport(operation),
  );
  const load = useCallback(async () => {
    if (
      !operationId ||
      !kind ||
      kind === "image_replacement" ||
      !supportsReport
    )
      return;
    setState("loading");
    try {
      const result = await getUploadValidationReport(kind, operationId);
      setReport(result);
      setState("loaded");
    } catch {
      setReport(null);
      setState("error");
    }
  }, [kind, operationId, supportsReport]);

  useEffect(() => {
    if (!open) return;
    setReport(null);
    setActiveTab(
      !supportsReport
        ? "information"
        : operation?.status === "rejected"
          ? "errors"
          : "warnings",
    );
    if (!operationId || !supportsReport) {
      setState("loaded");
      return;
    }
    void load();
  }, [load, open, operation?.status, operationId, supportsReport]);

  const title = operation ? operationTitle(operation) : "Detalle de carga";
  return (
    <AppDialog
      open={open}
      onOpenChange={onOpenChange}
      title={title}
      size="lg"
      contentClassName="flex flex-1 flex-col"
    >
      {!operation ? null : (
        <div className="flex min-h-0 flex-1 flex-col gap-4 text-sm text-secondary">
          <div className="rounded-control border border-[var(--border-subtle)] bg-surface p-3">
            <p className="m-0 font-medium text-text">
              {operation.seriesTitle}
              {operation.chapterNumber === null
                ? ""
                : ` · Capítulo ${operation.chapterNumber}`}
            </p>
            <p className="m-0 mt-1">
              {operation.filename} · {statusLabel(operation.status)}
            </p>
            {operation.status === "ready" && operation.warningCount > 0 ? (
              <p className="m-0 mt-1 text-warning-text">
                Carga completada con advertencias · {operation.warningCount}
              </p>
            ) : operation.status === "rejected" ? (
              <p className="m-0 mt-1 text-destructive-text">
                Carga rechazada
                {operation.issueCount
                  ? ` · ${operation.issueCount} problemas`
                  : ""}
              </p>
            ) : null}
            {operation.failureStage && operation.errorCode ? (
              <p className="m-0 mt-1 text-destructive-text">
                {safeErrorLabel(operation.errorCode)} · {operation.failureStage}
              </p>
            ) : null}
          </div>
          <div
            className="flex shrink-0 gap-1 border-b border-[var(--border-subtle)]"
            role="tablist"
            aria-label="Secciones del detalle"
          >
            <DetailTab
              active={activeTab === "warnings"}
              onClick={() => setActiveTab("warnings")}
            >
              Advertencias{" "}
              <span>{report?.warnings.length ?? operation.warningCount}</span>
            </DetailTab>
            <DetailTab
              active={activeTab === "errors"}
              onClick={() => setActiveTab("errors")}
            >
              Errores{" "}
              <span>{report?.issues.length ?? operation.issueCount}</span>
            </DetailTab>
            <DetailTab
              active={activeTab === "information"}
              onClick={() => setActiveTab("information")}
            >
              Información general
            </DetailTab>
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto pr-1">
            {activeTab === "information" ? (
              <OperationInformation
                operation={operation}
                requestId={report?.requestId ?? null}
              />
            ) : !supportsReport ? null : state === "loading" ? (
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
            ) : (
              <ValidationDetails
                operation={operation}
                report={report}
                section={activeTab}
              />
            )}
          </div>
        </div>
      )}
    </AppDialog>
  );
}

function ValidationDetails({
  operation,
  report,
  section,
}: {
  operation: UploadCenterRecord;
  report: UploadValidationReport | null;
  section: "warnings" | "errors";
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
    <div className="min-h-0 space-y-3 overflow-y-auto pr-1">
      {section === "errors"
        ? issues.map(([filename, items]) => (
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
          ))
        : null}
      {section === "warnings"
        ? warnings.map(([filename, items]) => (
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
                      <p className="m-0">
                        Umbral recomendado: {detail.threshold}
                      </p>
                    ) : null}
                  </div>
                );
              })}
            </section>
          ))
        : null}
      {section === "errors" && !issues.length ? (
        <p className="m-0">No hay errores de validación.</p>
      ) : section === "warnings" && !warnings.length ? (
        <p className="m-0">No hay advertencias de validación.</p>
      ) : null}
    </div>
  );
}

function DetailTab({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick(): void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      role="tab"
      aria-selected={active}
      className={`shrink-0 rounded-t-control px-3 py-2 text-xs ${active ? "bg-primary text-primary-foreground" : "text-secondary hover:bg-surface-hover"}`}
      onClick={onClick}
    >
      {children}
    </button>
  );
}

function OperationInformation({
  operation,
  requestId,
}: {
  operation: UploadCenterRecord;
  requestId: string | null;
}) {
  return (
    <dl className="grid min-w-0 grid-cols-[auto_1fr] gap-x-4 gap-y-2 text-sm">
      <dt>Serie</dt>
      <dd className="m-0 truncate text-text">{operation.seriesTitle}</dd>
      <dt>Capítulo</dt>
      <dd className="m-0 text-text">{operation.chapterNumber ?? "—"}</dd>
      <dt>ZIP</dt>
      <dd className="m-0 break-all text-text">{operation.filename}</dd>
      <dt>Estado</dt>
      <dd className="m-0 text-text">{statusLabel(operation.status)}</dd>
      <dt>Inicio</dt>
      <dd className="m-0 text-text">{formatDate(operation.createdAt)}</dd>
      <dt>Última actividad</dt>
      <dd className="m-0 text-text">
        {formatDate(operation.outcomeAt ?? operation.activityAt)}
      </dd>
      <dt>Operation ID</dt>
      <dd className="m-0 break-all text-text">{operation.id}</dd>
      {requestId ? (
        <>
          <dt>Request ID</dt>
          <dd className="m-0 break-all text-text">{requestId}</dd>
        </>
      ) : null}
    </dl>
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
function formatDate(value: string) {
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? "—"
    : new Intl.DateTimeFormat("es-PE", {
        dateStyle: "medium",
        timeStyle: "short",
      }).format(date);
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
