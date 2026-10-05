"use client";

import type { MediaWarning } from "@nodeprox/types";
import {
  Check,
  CheckCheck,
  ChevronRight,
  CircleAlert,
  FileArchive,
  LoaderCircle,
  Minus,
  RefreshCw,
  Upload,
  UploadCloud,
  X,
} from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { type ReactNode, useEffect, useMemo, useRef, useState } from "react";
import type { ImportBatchProjection } from "../../lib/domains/ingestion/types";
import {
  getUploadValidationReport,
  retryBackgroundUploadOperation,
  type UploadValidationReport,
} from "../../lib/domains/uploads/background-operations";
import {
  type UploadCenterBatch,
  useUploadQueue,
} from "../providers/upload-queue-provider";
import { AppDialog } from "../ui/app-dialog";
import { Button } from "../ui/button";
import { ProgressBar } from "../ui/progress-bar";

type UploadCenterTab = "active" | "completed" | "failed";
type UploadCenterItemRecord = {
  batch: UploadCenterBatch;
  item: ImportBatchProjection["items"][number];
  retryable: boolean;
  kind: "chapter_import" | "chapter_upload" | "chapter_replacement" | null;
  warningCount: number;
};

export function UploadCenter() {
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const pathname = usePathname();
  const previousPathname = useRef(pathname);
  const [tab, setTab] = useState<UploadCenterTab>("active");
  const [dismissedCompletedBatchIds, setDismissedCompletedBatchIds] = useState<
    ReadonlySet<string>
  >(new Set());
  const [dismissedCompletedOperationIds, setDismissedCompletedOperationIds] =
    useState<ReadonlySet<string>>(new Set());
  const [refreshing, setRefreshing] = useState(false);
  const [notice, setNotice] = useState<{
    title: string;
    body: string;
    seriesId: string;
    operationId: string;
  } | null>(null);
  const previousStatuses = useRef<Map<string, string> | null>(null);
  const announcedTransitions = useRef(new Set<string>());
  const queue = useUploadQueue();

  useEffect(() => {
    const current = new Map(
      queue.operations.map((operation) => [operation.id, operation.status]),
    );
    if (previousStatuses.current) {
      for (const operation of queue.operations) {
        const previous = previousStatuses.current.get(operation.id);
        const rejected = operation.status === "rejected";
        const warned =
          operation.status === "ready" && operation.warningCount > 0;
        if (
          !previous ||
          previous === operation.status ||
          (!rejected && !warned)
        )
          continue;
        const key = `${operation.id}:${operation.status}:${operation.warningCount}`;
        if (announcedTransitions.current.has(key)) continue;
        announcedTransitions.current.add(key);
        const body = rejected
          ? `${operation.filename}: el ZIP no superó la validación.`
          : `Carga completada. Se detectaron ${operation.warningCount} advertencias; no bloquearon el procesamiento.`;
        setNotice({
          title: rejected
            ? "Carga rechazada"
            : "Carga completada con advertencias",
          body,
          seriesId: operation.seriesId,
          operationId: operation.id,
        });
        if (
          (rejected || warned) &&
          ["chapter_import", "chapter_upload", "chapter_replacement"].includes(
            operation.kind,
          )
        ) {
          const kind = operation.kind as
            | "chapter_import"
            | "chapter_upload"
            | "chapter_replacement";
          void getUploadValidationReport(kind, operation.id)
            .then((report) => {
              const details = rejected
                ? report.issues
                    .map((issue) => {
                      const measurement = validationIssueMeasurement(issue);
                      return `${issue.filename ?? operation.filename} — ${validationIssueLabel(issue.code)}${measurement.actual ? `\nActual: ${measurement.actual}` : ""}${measurement.expected ? `\nMáximo: ${measurement.expected}` : ""}\nCódigo: ${issue.code}`;
                    })
                    .join("\n")
                : report.warnings
                    .map((warning) => {
                      const presentation = mediaWarningPresentation(warning);
                      return `${warning.filename}\n${presentation.title}\nActual: ${presentation.actual}${presentation.threshold ? `\nUmbral recomendado: ${presentation.threshold}` : ""}`;
                    })
                    .join("\n");
              setNotice((currentNotice) =>
                currentNotice?.operationId === operation.id
                  ? {
                      ...currentNotice,
                      body: `${body}${details ? `\n${details}` : ""}${rejected && report.requestId ? `\nRequest ID: ${report.requestId}` : ""}`,
                    }
                  : currentNotice,
              );
            })
            .catch(() => {
              setNotice((currentNotice) =>
                currentNotice?.operationId === operation.id
                  ? {
                      ...currentNotice,
                      body: `${body}\nNo se pudo cargar el detalle. Consulta el Centro de cargas.`,
                    }
                  : currentNotice,
              );
            });
        }
        break;
      }
    }
    previousStatuses.current = current;
  }, [queue.operations]);

  useEffect(() => {
    if (!open) return;

    function closeWhenLeaving(event: PointerEvent | FocusEvent) {
      if (
        !(event.target instanceof Node) ||
        !root.current?.contains(event.target)
      ) {
        setOpen(false);
      }
    }

    document.addEventListener("pointerdown", closeWhenLeaving);
    document.addEventListener("focusin", closeWhenLeaving);
    window.addEventListener("blur", closeWhenLeaving);
    return () => {
      document.removeEventListener("pointerdown", closeWhenLeaving);
      document.removeEventListener("focusin", closeWhenLeaving);
      window.removeEventListener("blur", closeWhenLeaving);
    };
  }, [open]);

  useEffect(() => {
    if (previousPathname.current !== pathname) {
      previousPathname.current = pathname;
      setOpen(false);
    }
  }, [pathname]);

  const records = useMemo(() => {
    const batchRecords = queue.batches.flatMap((batch) =>
      batch.projection
        ? batch.projection.items.map((item) => ({
            batch,
            item,
            retryable: isRetryableImportFailure(item.errorCode),
            kind: "chapter_import" as const,
            warningCount: item.warnings.length,
          }))
        : [],
    );
    const batchItemIds = new Set(batchRecords.map(({ item }) => item.itemId));
    const operationRecords = queue.operations
      .filter((operation) => !batchItemIds.has(operation.id))
      .filter((operation) => !dismissedCompletedOperationIds.has(operation.id))
      .map(
        (operation): UploadCenterItemRecord => ({
          batch: {
            batchId: operation.id,
            seriesId: operation.seriesId,
            seriesTitle: operation.seriesTitle,
            trackedAt: new Date(operation.createdAt).getTime(),
            projection: null,
          },
          item: {
            itemId: operation.id,
            clientId: operation.id,
            chapterNumber: operation.chapterNumber ?? 0,
            filename: operation.filename,
            chapterId: operation.chapterId,
            uploadId: null,
            status: normalizeOperationStatus(operation.status),
            errorCode: operation.errorCode,
            resolution: null,
            warnings: [],
          },
          retryable: false,
          kind: operation.kind === "image_replacement" ? null : operation.kind,
          warningCount: operation.warningCount,
        }),
      );
    return [...batchRecords, ...operationRecords];
  }, [dismissedCompletedOperationIds, queue.batches, queue.operations]);
  const visibleBatches = useMemo(
    () =>
      queue.batches.filter(
        (batch) =>
          !dismissedCompletedBatchIds.has(batch.batchId) ||
          !isReadyBatch(batch),
      ),
    [dismissedCompletedBatchIds, queue.batches],
  );
  const visibleBatchIds = useMemo(
    () => new Set(visibleBatches.map((batch) => batch.batchId)),
    [visibleBatches],
  );
  const visibleRecords = useMemo(
    () =>
      records.filter(({ batch, item }) => {
        const dismissedOperation =
          dismissedCompletedOperationIds.has(item.itemId) &&
          item.status === "ready";
        const dismissedBatch =
          dismissedCompletedBatchIds.has(batch.batchId) &&
          item.status === "ready";
        return !dismissedOperation && !dismissedBatch;
      }),
    [dismissedCompletedBatchIds, dismissedCompletedOperationIds, records],
  );
  const counts = useMemo(
    () => ({
      active: visibleRecords.filter(({ item }) => isActiveItem(item.status))
        .length,
      completed: visibleRecords.filter(({ item }) => item.status === "ready")
        .length,
      failed: visibleRecords.filter(({ item }) => isFailedItem(item.status))
        .length,
    }),
    [visibleRecords],
  );
  const tabItems = useMemo(
    () =>
      visibleRecords
        .filter(
          ({ batch, retryable }) =>
            !retryable || visibleBatchIds.has(batch.batchId),
        )
        .filter(({ item }) => itemMatchesTab(item, tab)),
    [tab, visibleBatchIds, visibleRecords],
  );
  const readyBatchIds = visibleBatches
    .filter(isReadyBatch)
    .map((batch) => batch.batchId);

  useEffect(() => {
    setDismissedCompletedBatchIds((current) => {
      const next = new Set(
        [...current].filter((batchId) => {
          const batch = queue.batches.find(
            (candidate) => candidate.batchId === batchId,
          );
          return Boolean(batch && isReadyBatch(batch));
        }),
      );
      return next.size === current.size ? current : next;
    });
  }, [queue.batches]);

  async function refresh() {
    setRefreshing(true);
    try {
      await queue.refresh();
    } finally {
      setRefreshing(false);
    }
  }

  return (
    <>
      <AppDialog
        open={Boolean(notice)}
        onOpenChange={(next) => {
          if (!next) setNotice(null);
        }}
        title={notice?.title ?? "Carga"}
      >
        <p className="m-0 whitespace-pre-line text-sm text-secondary">
          {notice?.body}
        </p>
        {notice?.title === "Carga rechazada" ? (
          <button
            className="mt-3 text-sm text-primary underline"
            type="button"
            onClick={() => {
              setNotice(null);
              setOpen(true);
              setTab("failed");
            }}
          >
            Ver en Centro de cargas
          </button>
        ) : null}
      </AppDialog>
      <div
        ref={root}
        className="fixed bottom-5 right-5 z-30 max-[767px]:bottom-3 max-[767px]:right-3"
      >
        {open ? (
          <section
            aria-label="Centro de cargas"
            className="absolute bottom-[calc(100%+0.875rem)] right-0 flex h-[min(44rem,calc(100dvh-7rem))] w-[min(38rem,calc(100vw-1.5rem))] flex-col overflow-hidden rounded-panel border border-[var(--border-subtle)] bg-surface-elevated shadow-panel"
          >
            <header className="flex items-start justify-between gap-4 border-b border-[var(--border-subtle)] px-5 py-4">
              <div className="flex min-w-0 items-center gap-3">
                <span className="grid size-9 shrink-0 place-items-center rounded-control bg-accent-soft text-primary">
                  <UploadCloud aria-hidden="true" className="size-5" />
                </span>
                <div>
                  <h2 className="m-0 text-base font-semibold text-text">
                    Centro de cargas
                  </h2>
                  <p className="m-0 text-sm text-secondary">
                    Seguimiento de cargas en segundo plano.
                  </p>
                </div>
              </div>
              <div className="flex shrink-0 gap-2">
                <IconButton
                  label="Minimizar centro de cargas"
                  onClick={() => setOpen(false)}
                >
                  <Minus aria-hidden="true" className="size-4" />
                </IconButton>
                <IconButton
                  label="Cerrar centro de cargas"
                  onClick={() => setOpen(false)}
                >
                  <X aria-hidden="true" className="size-4" />
                </IconButton>
              </div>
            </header>

            <div
              aria-label="Estado de cargas"
              className="flex shrink-0 gap-1 border-b border-[var(--border-subtle)] px-3 pt-2"
              role="tablist"
            >
              <CenterTab
                active={tab === "active"}
                count={counts.active}
                label="En progreso"
                onClick={() => setTab("active")}
              />
              <CenterTab
                active={tab === "completed"}
                count={counts.completed}
                label="Completadas"
                onClick={() => setTab("completed")}
              />
              <CenterTab
                active={tab === "failed"}
                count={counts.failed}
                label="Con errores"
                tone="danger"
                onClick={() => setTab("failed")}
              />
            </div>

            <div className="min-h-0 flex-1 overflow-y-auto p-4">
              {tabItems.length ? (
                <div className="divide-y divide-[var(--border-subtle)]">
                  {tabItems.map(
                    ({ batch, item, retryable, kind, warningCount }) => (
                      <UploadCenterItem
                        key={`${batch.batchId}:${item.itemId}`}
                        batch={batch}
                        item={item}
                        retryable={retryable}
                        kind={kind}
                        warningCount={warningCount}
                      />
                    ),
                  )}
                </div>
              ) : (
                <EmptyTab tab={tab} />
              )}
            </div>

            {tab === "active" && counts.active ? (
              <div className="mx-4 mb-4 flex gap-3 rounded-control border border-[var(--border-subtle)] bg-primary-soft px-3 py-3 text-sm text-secondary">
                <CircleAlert
                  aria-hidden="true"
                  className="mt-0.5 size-4 shrink-0 text-primary"
                />
                <p className="m-0">
                  Puedes cerrar este panel y seguir navegando. Si cierras el
                  navegador, una transferencia directa puede requerir reintento.
                </p>
              </div>
            ) : null}

            <footer className="flex shrink-0 items-center justify-between gap-3 border-t border-[var(--border-subtle)] px-4 py-3">
              <Button
                aria-label="Actualizar cargas"
                type="button"
                variant="secondary"
                size="sm"
                disabled={refreshing}
                onClick={() => void refresh()}
                icon={
                  <RefreshCw
                    aria-hidden="true"
                    className={`size-4 ${refreshing ? "animate-spin" : ""}`}
                  />
                }
              >
                Actualizar
              </Button>
              {tab === "completed" ? (
                <Button
                  type="button"
                  variant="secondary"
                  size="sm"
                  disabled={!counts.completed}
                  onClick={() => {
                    setDismissedCompletedBatchIds(
                      (current) => new Set([...current, ...readyBatchIds]),
                    );
                    setDismissedCompletedOperationIds(
                      (current) =>
                        new Set([
                          ...current,
                          ...records
                            .filter(
                              ({ item, retryable }) =>
                                !retryable && item.status === "ready",
                            )
                            .map(({ item }) => item.itemId),
                        ]),
                    );
                  }}
                  icon={<CheckCheck aria-hidden="true" className="size-4" />}
                >
                  Limpiar completadas
                </Button>
              ) : null}
            </footer>
          </section>
        ) : null}

        <button
          aria-label={
            open ? "Cerrar centro de cargas" : "Abrir centro de cargas"
          }
          aria-expanded={open}
          className="relative grid size-12 place-items-center rounded-full border border-primary/40 bg-primary text-primary-foreground shadow-panel transition-colors hover:bg-primary-hover focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary"
          type="button"
          onClick={() => setOpen((value) => !value)}
        >
          {queue.activeTransfers ? (
            <LoaderCircle aria-hidden="true" className="size-5 animate-spin" />
          ) : (
            <Upload aria-hidden="true" className="size-5" />
          )}
          {counts.active ? (
            <span className="absolute -right-1 -top-1 grid min-w-5 place-items-center rounded-full bg-primary px-1 text-xs font-semibold text-primary-foreground ring-2 ring-background">
              {counts.active}
            </span>
          ) : null}
        </button>
      </div>
    </>
  );
}

function CenterTab({
  active,
  count,
  label,
  tone = "default",
  onClick,
}: {
  active: boolean;
  count: number;
  label: string;
  tone?: "default" | "danger";
  onClick(): void;
}) {
  return (
    <button
      aria-selected={active}
      className={`relative inline-flex min-h-10 items-center gap-2 px-3 text-sm font-medium transition-colors ${active ? "text-text" : "text-secondary hover:text-text"}`}
      role="tab"
      type="button"
      onClick={onClick}
    >
      {label}
      <span
        className={`grid min-w-5 place-items-center rounded-full px-1 text-xs ${tone === "danger" ? "bg-destructive-surface text-destructive-text" : active ? "bg-primary text-primary-foreground" : "bg-surface-hover text-secondary"}`}
      >
        {count}
      </span>
      {active ? (
        <span className="absolute inset-x-1 bottom-0 h-0.5 rounded-full bg-primary" />
      ) : null}
    </button>
  );
}

function EmptyTab({ tab }: { tab: UploadCenterTab }) {
  const detail = {
    active: {
      icon: UploadCloud,
      title: "No hay cargas en progreso",
      copy: "Aquí se mostrarán los archivos que estés subiendo en segundo plano.",
    },
    completed: {
      icon: Check,
      title: "No hay cargas completadas",
      copy: "Las cargas finalizadas aparecerán aquí hasta que las limpies.",
    },
    failed: {
      icon: CircleAlert,
      title: "No hay cargas con errores",
      copy: "Los archivos que necesiten atención aparecerán aquí.",
    },
  }[tab];
  const Icon = detail.icon;
  return (
    <div className="grid h-full min-h-52 place-items-center rounded-control border border-[var(--border-subtle)] bg-surface px-6 text-center">
      <div className="grid max-w-xs justify-items-center gap-2">
        <span className="grid size-11 place-items-center rounded-full bg-accent-soft text-primary">
          <Icon aria-hidden="true" className="size-5" />
        </span>
        <p className="m-0 font-medium text-text">{detail.title}</p>
        <p className="m-0 text-sm text-secondary">{detail.copy}</p>
      </div>
    </div>
  );
}

export function isReadyBatch(batch: UploadCenterBatch) {
  return (
    batch.projection?.status === "completed" &&
    batch.projection.items.every((item) => item.status === "ready")
  );
}

export function isActiveItem(status: string) {
  return status !== "ready" && !isFailedItem(status);
}

function isFailedItem(status: string) {
  return ["failed", "rejected", "retry_exhausted", "terminal_failed"].includes(
    status,
  );
}

function itemMatchesTab(
  item: ImportBatchProjection["items"][number],
  tab: UploadCenterTab,
) {
  return tab === "active"
    ? isActiveItem(item.status)
    : tab === "completed"
      ? item.status === "ready"
      : isFailedItem(item.status);
}

function normalizeOperationStatus(
  status:
    | "pending"
    | "pending_upload"
    | "uploading"
    | "validating"
    | "rejected"
    | "retry_exhausted"
    | "terminal_failed"
    | "uploaded"
    | "processing"
    | "ready"
    | "completing"
    | "completed"
    | "failed",
): ImportBatchProjection["items"][number]["status"] {
  if (status === "completed") return "ready";
  if (status === "pending_upload") return "pending";
  if (status === "completing") return "processing";
  return status;
}

function UploadCenterItem({
  batch,
  item,
  retryable,
  kind,
  warningCount,
}: UploadCenterItemRecord) {
  const queue = useUploadQueue();
  const input = useRef<HTMLInputElement>(null);
  const [report, setReport] = useState<UploadValidationReport | null>(null);
  const [reportState, setReportState] = useState<
    "idle" | "loading" | "loaded" | "error"
  >("idle");
  const [retrying, setRetrying] = useState(false);
  const [retryError, setRetryError] = useState<string | null>(null);
  useEffect(() => {
    const needsReport =
      item.status === "rejected" ||
      (item.status === "ready" && warningCount > 0);
    if (!needsReport || !kind) {
      setReport(null);
      setReportState("idle");
      return;
    }
    let active = true;
    setReportState("loading");
    void getUploadValidationReport(kind, item.itemId)
      .then((value) => {
        if (active) {
          setReport(value);
          setReportState("loaded");
        }
      })
      .catch(() => {
        if (active) {
          setReport(null);
          setReportState("error");
        }
      });
    return () => {
      active = false;
    };
  }, [item.status, warningCount, item.itemId, kind]);
  const progress = queue.progressFor(batch.batchId, item.itemId);
  const canRetry = retryable && item.status === "failed";
  const requiresReplacement = requiresChapterReplacement(item.errorCode);
  const canAbort =
    item.status === "uploading" && Boolean(item.chapterId && item.uploadId);
  const isCompleted = item.status === "ready";
  const title = `Capítulo ${item.chapterNumber} · ${batch.seriesTitle}`;
  return (
    <article className="flex gap-3 py-3 first:pt-0 last:pb-0">
      <span className="grid size-11 shrink-0 place-items-center rounded-control border border-[var(--border-subtle)] bg-surface text-primary">
        {isCompleted ? (
          <Check aria-hidden="true" className="size-5 text-success" />
        ) : isFailedItem(item.status) ? (
          <CircleAlert
            aria-hidden="true"
            className="size-5 text-destructive-text"
          />
        ) : (
          <FileArchive aria-hidden="true" className="size-5" />
        )}
      </span>
      <div className="min-w-0 flex-1">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="m-0 truncate text-sm font-semibold text-text">
              {title}
            </p>
            <p className="m-0 truncate text-xs text-secondary">
              {item.filename}
            </p>
          </div>
          <div className="flex shrink-0 items-center gap-1.5">
            {isCompleted && item.chapterId ? (
              <Link
                aria-label={`Abrir ${title}`}
                className="grid size-8 place-items-center rounded-control border border-[var(--border-subtle)] text-secondary hover:bg-surface-hover hover:text-text focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary"
                href={`/series/${batch.seriesId}/chapters`}
              >
                <ChevronRight aria-hidden="true" className="size-4" />
              </Link>
            ) : null}
            {requiresReplacement && item.chapterId ? (
              <Link
                aria-label={`Gestionar ${title}`}
                className="inline-flex h-8 items-center rounded-control border border-[var(--border-subtle)] px-2 text-xs font-medium text-secondary hover:bg-surface-hover hover:text-text focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary"
                href={`/series/${batch.seriesId}/chapters`}
              >
                Cambiar capítulo
              </Link>
            ) : null}
            {canAbort && item.chapterId && item.uploadId ? (
              <IconButton
                label={`Cancelar transferencia de ${title}`}
                onClick={() =>
                  void queue.abortTransfer({
                    batchId: batch.batchId,
                    chapterId: item.chapterId as string,
                    uploadId: item.uploadId as string,
                  })
                }
              >
                <X aria-hidden="true" className="size-4" />
              </IconButton>
            ) : null}
          </div>
        </div>
        {isActiveItem(item.status) ? (
          <div className="mt-2 grid gap-1.5">
            <div className="flex items-center justify-between gap-3 text-xs text-secondary">
              <span>{statusLabel(item.status)}</span>
              {progress !== undefined ? <span>{progress}%</span> : null}
            </div>
            <ProgressBar value={progress ?? 0} label={`Progreso de ${title}`} />
          </div>
        ) : null}
        {isCompleted ? (
          <p className="mt-2 flex items-center gap-1.5 text-xs text-secondary">
            <Check aria-hidden="true" className="size-3.5 text-success" />
            {warningCount > 0
              ? `Completada con ${warningCount} advertencias`
              : "Completada"}
          </p>
        ) : null}
        {item.errorCode ? (
          <p className="mt-2 text-xs text-destructive-text">
            {errorLabel(item.errorCode)}
          </p>
        ) : null}
        {item.status === "rejected" || (isCompleted && warningCount > 0) ? (
          <div
            className={`mt-2 space-y-1 text-xs ${item.status === "rejected" ? "text-destructive-text" : "text-secondary"}`}
          >
            {item.status === "rejected" ? <p>Carga rechazada</p> : null}
            {item.status === "rejected"
              ? report?.issues.map((issue) => (
                  <p key={issue.id}>
                    {issue.filename ??
                      (issue.fileIndex
                        ? `Archivo ${issue.fileIndex}`
                        : "ZIP")}{" "}
                    — {validationIssueLabel(issue.code)}
                    {validationIssueMeasurement(issue).actual
                      ? ` · Actual: ${validationIssueMeasurement(issue).actual}`
                      : ""}
                    {validationIssueMeasurement(issue).expected
                      ? ` · Máximo: ${validationIssueMeasurement(issue).expected}`
                      : ""}
                    {` · Código: ${issue.code}`}
                  </p>
                ))
              : null}
            {report?.warnings.map((warning) => (
              <p key={JSON.stringify(warning)} className="text-warning">
                <span>
                  {warning.filename} — {mediaWarningPresentation(warning).title}
                </span>
                <span>Actual: {mediaWarningPresentation(warning).actual}</span>
                {mediaWarningPresentation(warning).threshold ? (
                  <span>
                    Umbral recomendado:{" "}
                    {mediaWarningPresentation(warning).threshold}
                  </span>
                ) : null}
              </p>
            ))}
            {reportState === "loading" ? (
              <p>Cargando informe de validación…</p>
            ) : null}
            {reportState === "error" ? (
              <p role="alert">
                No se pudo cargar el detalle.{" "}
                <button
                  className="underline"
                  type="button"
                  onClick={() => {
                    if (!kind) return;
                    setReportState("loading");
                    void getUploadValidationReport(kind, item.itemId)
                      .then((value) => {
                        setReport(value);
                        setReportState("loaded");
                      })
                      .catch(() => setReportState("error"));
                  }}
                >
                  Reintentar detalle
                </button>
              </p>
            ) : null}
            {report?.requestId ? <p>Request ID: {report.requestId}</p> : null}
          </div>
        ) : null}
        {item.status === "retry_exhausted" ? (
          <div className="mt-2 space-y-2 text-xs text-secondary">
            <p>
              No se pudo continuar por un problema temporal. El archivo original
              se conserva.
            </p>
            {kind ? (
              <Button
                type="button"
                size="sm"
                variant="secondary"
                disabled={retrying}
                icon={<RefreshCw aria-hidden="true" className="size-3.5" />}
                onClick={() => {
                  setRetrying(true);
                  setRetryError(null);
                  void retryBackgroundUploadOperation(kind, item.itemId)
                    .then(() => queue.refresh())
                    .catch(() =>
                      setRetryError("No se pudo solicitar el reintento."),
                    )
                    .finally(() => setRetrying(false));
                }}
              >
                Reintentar procesamiento
              </Button>
            ) : null}
            {retryError ? (
              <p className="text-destructive-text">{retryError}</p>
            ) : null}
          </div>
        ) : null}
        {item.status === "terminal_failed" ? (
          <p className="mt-2 text-xs text-destructive-text">
            La carga se detuvo por un error de configuración. El archivo
            original se conserva.
          </p>
        ) : null}
        {canRetry ? (
          <div className="mt-2">
            <input
              ref={input}
              className="sr-only"
              type="file"
              accept=".zip,application/zip,application/x-zip-compressed"
              onChange={(event) => {
                const file = event.target.files?.[0];
                if (file)
                  void queue.retryWithFile({
                    batchId: batch.batchId,
                    seriesId: batch.seriesId,
                    itemId: item.itemId,
                    file,
                  });
                event.currentTarget.value = "";
              }}
            />
            <Button
              type="button"
              size="sm"
              variant="secondary"
              icon={<RefreshCw aria-hidden="true" className="size-3.5" />}
              onClick={() => input.current?.click()}
            >
              Reintentar ZIP
            </Button>
          </div>
        ) : null}
      </div>
    </article>
  );
}

function IconButton({
  children,
  label,
  onClick,
}: {
  children: ReactNode;
  label: string;
  onClick(): void;
}) {
  return (
    <button
      aria-label={label}
      className="grid size-8 place-items-center rounded-control border border-[var(--border-subtle)] text-secondary transition-colors hover:bg-surface-hover hover:text-text focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary"
      type="button"
      onClick={onClick}
    >
      {children}
    </button>
  );
}

function statusLabel(status: string) {
  return (
    {
      pending: "En espera",
      uploading: "Subiendo archivo…",
      validating: "Validando archivo…",
      uploaded: "Archivo subido. Procesando…",
      processing: "Procesando imágenes…",
      ready: "Completada",
      failed: "Error",
      rejected: "Carga rechazada",
      retry_exhausted: "Reintento necesario",
      terminal_failed: "Error de configuración",
    }[status] ?? status
  );
}

export function mediaWarningPresentation(warning: MediaWarning): {
  title: string;
  actual: string;
  threshold?: string;
} {
  switch (warning.code) {
    case "large-file":
      return {
        title: "Archivo grande",
        actual: formatMiB(warning.sizeBytes),
        ...(warning.thresholdBytes !== undefined
          ? { threshold: formatMiB(warning.thresholdBytes) }
          : {}),
      };
    case "wide-image":
      return {
        title: "Imagen muy ancha",
        actual: `${formatInteger(warning.width)} px`,
        ...(warning.thresholdWidth !== undefined
          ? { threshold: `${formatInteger(warning.thresholdWidth)} px` }
          : {}),
      };
    case "tall-image":
      return {
        title: "Imagen muy alta",
        actual: `${formatInteger(warning.height)} px`,
        ...(warning.thresholdHeight !== undefined
          ? { threshold: `${formatInteger(warning.thresholdHeight)} px` }
          : {}),
      };
  }
}

export function validationIssueMeasurement(issue: {
  code: string;
  actual?: Record<string, unknown> | null;
  expected?: Record<string, unknown> | null;
}): { actual?: string; expected?: string } {
  const actual = issue.actual ?? {};
  const expected = issue.expected ?? {};
  const number = (record: Record<string, unknown>, ...keys: string[]) => {
    for (const key of keys) {
      const value = record[key];
      if (typeof value === "number" && Number.isFinite(value)) return value;
    }
    return undefined;
  };
  let actualValue: number | undefined;
  let expectedValue: number | undefined;
  let format: (value: number) => string;
  switch (issue.code) {
    case "IMAGE_SIZE_EXCEEDED":
      actualValue = number(actual, "sizeBytes");
      expectedValue = number(expected, "maxImageBytes", "maxSizeBytes");
      format = formatMiB;
      break;
    case "IMAGE_WIDTH_EXCEEDED":
      actualValue = number(actual, "widthPx", "width");
      expectedValue = number(expected, "maxWidthPx", "widthPx");
      format = (value) => `${formatInteger(value)} px`;
      break;
    case "IMAGE_HEIGHT_EXCEEDED":
      actualValue = number(actual, "heightPx", "height");
      expectedValue = number(expected, "maxHeightPx", "heightPx");
      format = (value) => `${formatInteger(value)} px`;
      break;
    case "IMAGE_PIXELS_EXCEEDED":
      actualValue = number(actual, "pixels");
      expectedValue = number(expected, "maxPixels");
      format = (value) => formatInteger(value);
      break;
    case "ZIP_COMPRESSION_RATIO_EXCEEDED":
      actualValue = number(actual, "compressionRatio", "ratio");
      expectedValue = number(expected, "maxCompressionRatio");
      format = (value) =>
        `${new Intl.NumberFormat("es-PE", { maximumFractionDigits: 1 }).format(value)}×`;
      break;
    default:
      return {};
  }
  return {
    ...(actualValue !== undefined ? { actual: format(actualValue) } : {}),
    ...(expectedValue !== undefined ? { expected: format(expectedValue) } : {}),
  };
}

function formatMiB(bytes: number): string {
  const value = bytes / (1024 * 1024);
  return `${value.toFixed(1).replace(/\.0$/, "")} MB`;
}

function formatInteger(value: number): string {
  return new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 })
    .format(value)
    .replace(/,/g, " ");
}

function validationIssueLabel(code: string): string {
  const labels: Record<string, string> = {
    ZIP_INVALID: "ZIP inválido",
    ZIP_INVALID_PATH: "Ruta no permitida",
    ZIP_INVALID_LAYOUT: "Estructura inválida",
    ZIP_ENTRY_LIMIT_EXCEEDED: "Demasiados archivos",
    ZIP_TOTAL_SIZE_EXCEEDED: "Tamaño total excedido",
    ZIP_COMPRESSION_RATIO_EXCEEDED: "Compresión ZIP excesiva",
    IMAGE_FILENAME_INVALID: "Nombre de imagen inválido",
    IMAGE_DUPLICATE_FILENAME: "Nombre duplicado",
    IMAGE_DUPLICATE_SORT_ORDER: "Orden duplicado",
    IMAGE_EXTENSION_UNSUPPORTED: "Extensión no compatible",
    IMAGE_MAGIC_MISMATCH: "Contenido incompatible con la extensión",
    IMAGE_SIZE_EXCEEDED: "Tamaño máximo excedido",
    IMAGE_WIDTH_EXCEEDED: "Ancho máximo excedido",
    IMAGE_HEIGHT_EXCEEDED: "Altura máxima excedida",
    IMAGE_PIXELS_EXCEEDED: "Píxeles máximos excedidos",
    IMAGE_DIMENSIONS_UNREADABLE: "Dimensiones ilegibles",
  };
  return labels[code] ?? code;
}

export function errorLabel(code: string) {
  return (
    {
      "chapter-upload-active": "El capítulo ya tiene una carga activa.",
      "chapter-processing": "El capítulo se está procesando.",
      "chapter-uploaded":
        "El capítulo ya tiene una carga completada. Usa Cambiar capítulo para reemplazar sus imágenes.",
      "chapter-ready":
        "El capítulo ya está listo. Usa Cambiar capítulo para reemplazar sus imágenes.",
      "chapter-media-exists":
        "El capítulo ya contiene imágenes. Usa Cambiar capítulo para reemplazarlas.",
      "chapter-failed":
        "El capítulo tiene una carga fallida. Gestiona ese capítulo para reintentarla.",
      "chapter-deleting": "El capítulo se está eliminando.",
      "bulk-item-limit": "El batch supera el máximo de 15 ZIP.",
    }[code] ??
    "La carga no se pudo completar. Selecciona el ZIP para reintentar."
  );
}

export function requiresChapterReplacement(errorCode: string | null): boolean {
  return ["chapter-uploaded", "chapter-ready", "chapter-media-exists"].includes(
    errorCode ?? "",
  );
}

export function isRetryableImportFailure(errorCode: string | null): boolean {
  return ![
    "chapter-upload-active",
    "chapter-uploaded",
    "chapter-processing",
    "chapter-ready",
    "chapter-failed",
    "chapter-deleting",
    "chapter-media-exists",
    "import-batch-item-conflict",
    "authorization-denied",
    "resource-not-found",
  ].includes(errorCode ?? "");
}
