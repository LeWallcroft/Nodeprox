"use client";

import {
  ChevronDown,
  ChevronRight,
  FileArchive,
  Gauge,
  Hash,
  Images,
  RefreshCw,
  ShieldCheck,
  TriangleAlert,
} from "lucide-react";
import { type ReactNode, useId, useState } from "react";
import type { LucideIcon } from "lucide-react";
import type { UserUploadPolicy } from "../../../lib/domains/uploads/upload-policy";

type UploadRequirementsProps = {
  policy: UserUploadPolicy | null;
  loading?: boolean;
  error?: boolean;
  onRetry?: () => void;
  compact?: boolean;
  defaultOpen?: boolean;
};

export function UploadRequirements({
  policy,
  loading = false,
  error = false,
  onRetry,
  compact = false,
  defaultOpen = false,
}: UploadRequirementsProps) {
  const [open, setOpen] = useState(defaultOpen);
  const contentId = useId();

  return (
    <section className="rounded-control bg-surface p-3">
      <button
        aria-controls={contentId}
        aria-expanded={open}
        className="flex w-full items-center gap-3 rounded-control px-1 py-1 text-left hover:bg-surface-hover focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary"
        type="button"
        onClick={() => setOpen((value) => !value)}
      >
        <span className="grid size-9 shrink-0 place-items-center rounded-full bg-primary-soft text-primary">
          <ShieldCheck aria-hidden="true" className="size-5" />
        </span>
        <span className="min-w-0 flex-1">
          <span className="block font-semibold text-text">
            Requisitos para la carga
          </span>
          {policy ? (
            <span className="mt-1 flex flex-wrap gap-x-3 gap-y-1 text-xs">
              <Category
                icon={FileArchive}
                label="ZIP"
                className="text-primary"
              />
              <Category
                icon={Images}
                label="Formatos"
                className="text-primary"
              />
              <Category
                icon={Hash}
                label="Nombres"
                className="text-secondary"
              />
              <Category
                icon={ShieldCheck}
                label="Límites"
                className="text-success"
              />
              <Category
                icon={TriangleAlert}
                label="Advertencias"
                className="text-warning"
              />
              {!compact ? (
                <Category
                  icon={Gauge}
                  label="Concurrencia"
                  className="text-primary"
                />
              ) : null}
            </span>
          ) : null}
        </span>
        {open ? (
          <ChevronDown
            aria-hidden="true"
            className="size-4 shrink-0 text-secondary"
          />
        ) : (
          <ChevronRight
            aria-hidden="true"
            className="size-4 shrink-0 text-secondary"
          />
        )}
      </button>
      {open ? (
        <div
          className="mt-3 max-h-64 overflow-y-auto overscroll-contain"
          id={contentId}
        >
          {loading && !policy ? (
            <p className="m-0 rounded-control bg-surface-elevated p-3 text-sm text-secondary">
              Cargando requisitos…
            </p>
          ) : error && !policy ? (
            <div className="flex flex-wrap items-center justify-between gap-2 rounded-control bg-surface-elevated p-3">
              <p className="m-0 text-sm text-secondary">
                No se pudieron cargar los requisitos.
              </p>
              {onRetry ? (
                <button
                  className="inline-flex items-center gap-2 rounded-control px-3 py-2 text-sm text-primary hover:bg-surface-hover"
                  type="button"
                  onClick={onRetry}
                >
                  <RefreshCw aria-hidden="true" className="size-4" />
                  Reintentar
                </button>
              ) : null}
            </div>
          ) : policy ? (
            <div className="grid gap-2">
              <RequirementGroup
                icon={<FileArchive aria-hidden="true" className="size-5" />}
                title="ZIP"
                tone="primary"
                rows={[
                  [
                    "Tamaño máximo del ZIP",
                    formatBytes(policy.zip.maxUploadBytes),
                  ],
                  ["Máximo de entradas", formatNumber(policy.zip.maxEntries)],
                  [
                    "Contenido expandido máximo",
                    formatBytes(policy.zip.maxExpandedBytes),
                  ],
                  ["Estructura", "Plana o una única carpeta contenedora"],
                ]}
              />
              <RequirementGroup
                icon={<Images aria-hidden="true" className="size-5" />}
                title="Formatos y nombres"
                tone="primary"
                rows={[
                  [
                    "Formatos permitidos",
                    policy.images.allowedExtensions
                      .map((ext) => ext.toUpperCase())
                      .join(" · "),
                  ],
                  ["Ejemplos", "00.jpg · 01.webp · 02.png"],
                  ["Regla de nombre", "Usa una secuencia de dos dígitos."],
                ]}
              />
              <RequirementGroup
                icon={<ShieldCheck aria-hidden="true" className="size-5" />}
                title="Límites obligatorios"
                tone="success"
                rows={[
                  [
                    "Máximo permitido por imagen",
                    formatBytes(policy.images.maxImageBytes),
                  ],
                  ...optionalLimitRows(policy),
                ]}
              />
              <RequirementGroup
                icon={<TriangleAlert aria-hidden="true" className="size-5" />}
                title="Advertencias"
                tone="warning"
                description="No bloquean la carga; sirven como recomendación."
                rows={[
                  [
                    "Archivo pesado desde",
                    formatBytes(policy.warnings.imageBytes),
                  ],
                  [
                    "Ancho desde",
                    `${formatNumber(policy.warnings.widthPx)} px`,
                  ],
                  [
                    "Altura desde",
                    `${formatNumber(policy.warnings.heightPx)} px`,
                  ],
                ]}
              />
              <RequirementGroup
                icon={<Gauge aria-hidden="true" className="size-5" />}
                title="Concurrencia"
                tone="primary"
                rows={[
                  [
                    "Cargas ZIP simultáneas",
                    String(policy.transfer.maxConcurrentUploads),
                  ],
                ]}
              />
            </div>
          ) : (
            <p className="m-0 rounded-control bg-surface-elevated p-3 text-sm text-secondary">
              Cargando requisitos…
            </p>
          )}
        </div>
      ) : null}
    </section>
  );
}

function Category({
  icon: Icon,
  label,
  className,
}: {
  icon: LucideIcon;
  label: string;
  className: string;
}) {
  return (
    <span className={`inline-flex items-center gap-1 ${className}`}>
      <Icon aria-hidden="true" className="size-3.5" />
      {label}
    </span>
  );
}

function RequirementGroup({
  icon,
  title,
  tone,
  rows,
  description,
}: {
  icon: ReactNode;
  title: string;
  tone: "primary" | "success" | "warning";
  rows: readonly (readonly [string, string])[];
  description?: string;
}) {
  const toneClass = {
    primary: "bg-primary-soft text-primary",
    success: "bg-success/10 text-success",
    warning: "bg-warning/10 text-warning",
  }[tone];
  return (
    <section className="rounded-control bg-surface-elevated p-3">
      <h3 className="m-0 flex items-center gap-2 text-sm font-semibold text-text">
        <span
          className={`grid size-8 shrink-0 place-items-center rounded-full ${toneClass}`}
        >
          {icon}
        </span>
        {title}
      </h3>
      {description ? (
        <p className="mb-2 mt-2 text-xs text-secondary">{description}</p>
      ) : null}
      <dl className="mb-0 mt-2 grid gap-2 text-xs">
        {rows.map(([label, value]) => (
          <div
            className="flex flex-wrap justify-between gap-x-3 gap-y-0.5"
            key={label}
          >
            <dt className="text-secondary">{label}</dt>
            <dd className="m-0 text-right font-medium text-text">{value}</dd>
          </div>
        ))}
      </dl>
    </section>
  );
}

function optionalLimitRows(policy: UserUploadPolicy): [string, string][] {
  const rows: [string, string][] = [];
  if (policy.images.maxWidthPx !== null)
    rows.push([
      "Ancho máximo permitido",
      `${formatNumber(policy.images.maxWidthPx)} px`,
    ]);
  if (policy.images.maxHeightPx !== null)
    rows.push([
      "Altura máxima permitida",
      `${formatNumber(policy.images.maxHeightPx)} px`,
    ]);
  if (policy.images.maxPixels !== null)
    rows.push([
      "Píxeles máximos permitidos",
      formatNumber(policy.images.maxPixels),
    ]);
  if (policy.images.maxCompressionRatio !== null)
    rows.push([
      "Relación máxima de compresión",
      `${policy.images.maxCompressionRatio}x`,
    ]);
  return rows;
}

function formatBytes(bytes: number) {
  const units = ["B", "KB", "MB", "GB"];
  let value = bytes;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  return `${formatNumber(Number(value.toFixed(unit === 0 ? 0 : 1)))} ${units[unit]}`;
}

function formatNumber(value: number) {
  return new Intl.NumberFormat("es-PE", { maximumFractionDigits: 1 }).format(
    value,
  );
}
