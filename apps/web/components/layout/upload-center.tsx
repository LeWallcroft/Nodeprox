"use client";

import {
  Check,
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
import {
  type ReactNode,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { retryBackgroundUploadOperation } from "../../lib/domains/uploads/background-operations";
import {
  type DismissedUploadOutcome,
  fillOutcomeNoticeSlots,
  isTerminalUploadStatus,
  isUploadOutcomeDismissed,
  observeUploadOutcomeTransitions,
  sanitizeDismissedUploadOutcomes,
  uploadCenterDismissalStorageKey,
} from "../../lib/domains/uploads/upload-center-state";
import {
  canLoadValidationReport,
  compareUploadCenterRecords,
  mergeUploadCenterRecords,
  type UploadCenterRecord,
  uploadCenterSummary,
} from "../../lib/domains/uploads/upload-center-view-model";
import { UploadOperationDetailDialog } from "../domains/uploads/upload-operation-detail-dialog";
import { UploadOutcomeMessage } from "../domains/uploads/upload-outcome-message";
import { UploadResultDialog } from "../domains/uploads/upload-result-dialog";
import { useUploadQueue } from "../providers/upload-queue-provider";
import { Button } from "../ui/button";
import { ProgressBar } from "../ui/progress-bar";

type Tab = "active" | "completed" | "failed";
type Notice = {
  key: string;
  record: UploadCenterRecord;
  batchSummary?: {
    completed: number;
    warnings: number;
    rejected: number;
    failed: number;
  };
};

export function UploadCenter() {
  const queue = useUploadQueue();
  const pathname = usePathname();
  const root = useRef<HTMLDivElement>(null);
  const previousPathname = useRef(pathname);
  const previousOperations = useRef<Map<string, string> | null>(null);
  const announced = useRef(new Set<string>());
  const [open, setOpen] = useState(false);
  const [tab, setTab] = useState<Tab>("active");
  const [refreshing, setRefreshing] = useState(false);
  const [detail, setDetail] = useState<UploadCenterRecord | null>(null);
  const [resultQueue, setResultQueue] = useState<UploadCenterRecord[]>([]);
  const [dismissed, setDismissed] = useState<readonly DismissedUploadOutcome[]>(
    [],
  );
  const [dismissalLoaded, setDismissalLoaded] = useState(false);
  const [dismissalUserId, setDismissalUserId] = useState<string | null>(null);
  const [visibleNotices, setVisibleNotices] = useState<Notice[]>([]);
  const [pendingNotices, setPendingNotices] = useState<Notice[]>([]);
  const records = useMemo(
    () =>
      mergeUploadCenterRecords({
        operations: queue.operations,
        batches: queue.batches,
      }),
    [queue.batches, queue.operations],
  );
  const recordsById = useMemo(
    () => new Map(records.map((record) => [record.id, record])),
    [records],
  );

  useEffect(() => {
    setDismissalLoaded(false);
    if (!queue.userId || typeof window === "undefined") {
      setDismissed([]);
      setDismissalUserId(queue.userId);
      setDismissalLoaded(true);
      return;
    }
    try {
      const raw = window.localStorage.getItem(
        uploadCenterDismissalStorageKey(queue.userId),
      );
      setDismissed(
        sanitizeDismissedUploadOutcomes(raw ? JSON.parse(raw) : [], Date.now()),
      );
    } catch {
      setDismissed([]);
    }
    setDismissalUserId(queue.userId);
    setDismissalLoaded(true);
  }, [queue.userId]);

  const persistDismissed = useCallback(
    (next: readonly DismissedUploadOutcome[]) => {
      const sanitized = sanitizeDismissedUploadOutcomes(next, Date.now());
      setDismissed(sanitized);
      if (!queue.userId || typeof window === "undefined") return;
      try {
        window.localStorage.setItem(
          uploadCenterDismissalStorageKey(queue.userId),
          JSON.stringify(sanitized),
        );
      } catch {
        /* UI dismissal remains available for this session. */
      }
    },
    [queue.userId],
  );

  const dismissRecord = useCallback(
    (record: UploadCenterRecord) => {
      persistDismissed([
        ...dismissed.filter(
          (entry) =>
            !(
              entry.operationId === record.id &&
              entry.fingerprint === record.outcomeFingerprint
            ),
        ),
        {
          operationId: record.id,
          fingerprint: record.outcomeFingerprint,
          dismissedAt: Date.now(),
        },
      ]);
    },
    [dismissed, persistDismissed],
  );

  useEffect(() => {
    if (!queue.operationsLoaded) return;
    const previous = previousOperations.current;
    const observed = observeUploadOutcomeTransitions({
      operations: queue.operations,
      recordsById,
      previousStatuses: previous,
      announcedKeys: announced.current,
    });
    previousOperations.current = observed.currentStatuses;
    if (!observed.notices.length) return;

    const groups = new Map<string, UploadCenterRecord[]>();
    for (const record of records) {
      if (record.kind !== "chapter_import" || !record.batchId) continue;
      groups.set(record.batchId, [
        ...(groups.get(record.batchId) ?? []),
        record,
      ]);
    }
    const isBulkImport = (record: UploadCenterRecord) =>
      record.kind === "chapter_import" &&
      Boolean(record.batchId && (groups.get(record.batchId)?.length ?? 0) > 1);
    const individual = observed.notices.filter(
      (notice) => !isBulkImport(notice.record),
    );
    if (individual.length)
      setResultQueue((old) => {
        const known = new Set(old.map((record) => record.outcomeFingerprint));
        return [
          ...old,
          ...individual
            .map((notice) => notice.record)
            .filter((record) => !known.has(record.outcomeFingerprint)),
        ];
      });

    const notices: Notice[] = observed.notices
      .filter((notice) => isBulkImport(notice.record))
      .map(({ key, record }) => ({ key, record }));
    if (previous) {
      for (const [batchId, group] of groups) {
        if (
          group.length < 2 ||
          !group.every((record) => isTerminalUploadStatus(record.status))
        )
          continue;
        const newlyCompleted = group.some((record) => {
          const oldStatus = previous.get(record.id)?.split(":")[0];
          return oldStatus !== undefined && !isTerminalUploadStatus(oldStatus);
        });
        if (!newlyCompleted) continue;
        const ordered = [...group].sort(compareUploadCenterRecords);
        const record = ordered[0];
        if (!record) continue;
        const key = `batch:${batchId}:${group
          .map(
            (item) =>
              `${item.id}:${item.status}:${item.warningCount}:${item.outcomeAt}`,
          )
          .sort()
          .join("|")}`;
        if (announced.current.has(key)) continue;
        announced.current.add(key);
        notices.push({
          key,
          record,
          batchSummary: {
            completed: group.filter(
              (item) =>
                ["ready", "completed"].includes(item.status) &&
                !item.warningCount,
            ).length,
            warnings: group.filter((item) => item.warningCount > 0).length,
            rejected: group.filter((item) => item.status === "rejected").length,
            failed: group.filter((item) =>
              ["failed", "retry_exhausted", "terminal_failed"].includes(
                item.status,
              ),
            ).length,
          },
        });
      }
    }
    if (notices.length) setPendingNotices((old) => [...old, ...notices]);
  }, [queue.operations, queue.operationsLoaded, records, recordsById]);

  useEffect(() => {
    if (visibleNotices.length >= 3 || !pendingNotices.length) return;
    const filled = fillOutcomeNoticeSlots(visibleNotices, pendingNotices);
    setVisibleNotices([...filled.visible]);
    setPendingNotices([...filled.pending]);
  }, [pendingNotices, visibleNotices]);

  useEffect(() => {
    if (previousPathname.current !== pathname) {
      previousPathname.current = pathname;
      setOpen(false);
    }
  }, [pathname]);

  useEffect(() => {
    if (!open || detail) return;
    function closeWhenLeaving(event: PointerEvent | FocusEvent) {
      if (!(event.target instanceof Element)) return;
      if (
        root.current?.contains(event.target) ||
        event.target.closest('[aria-label="Notificaciones de cargas"]')
      )
        return;
      setOpen(false);
    }
    document.addEventListener("pointerdown", closeWhenLeaving);
    document.addEventListener("focusin", closeWhenLeaving);
    window.addEventListener("blur", closeWhenLeaving);
    return () => {
      document.removeEventListener("pointerdown", closeWhenLeaving);
      document.removeEventListener("focusin", closeWhenLeaving);
      window.removeEventListener("blur", closeWhenLeaving);
    };
  }, [detail, open]);

  const visibleRecords = useMemo(
    () =>
      records.filter((record) => {
        const terminal = [
          "ready",
          "completed",
          "rejected",
          "failed",
          "retry_exhausted",
          "terminal_failed",
        ].includes(record.status);
        if (!terminal) return true;
        if (!dismissalLoaded || dismissalUserId !== queue.userId) return false;
        return !isUploadOutcomeDismissed(record, dismissed);
      }),
    [dismissalLoaded, dismissalUserId, dismissed, queue.userId, records],
  );
  const completed = (record: UploadCenterRecord) =>
    ["ready", "completed"].includes(record.status);
  const failed = (record: UploadCenterRecord) =>
    ["rejected", "failed", "retry_exhausted", "terminal_failed"].includes(
      record.status,
    );
  const active = (record: UploadCenterRecord) =>
    !completed(record) && !failed(record);
  const counts = {
    active: visibleRecords.filter(active).length,
    completed: visibleRecords.filter(completed).length,
    failed: visibleRecords.filter(failed).length,
  };
  const tabRecords = visibleRecords
    .filter((record) =>
      tab === "active"
        ? active(record)
        : tab === "completed"
          ? completed(record)
          : failed(record),
    )
    .sort(compareUploadCenterRecords);

  async function refresh() {
    setRefreshing(true);
    try {
      await queue.refresh();
    } finally {
      setRefreshing(false);
    }
  }
  function dismissVisible(predicate: (record: UploadCenterRecord) => boolean) {
    const additions = visibleRecords.filter(predicate).map((record) => ({
      operationId: record.id,
      fingerprint: record.outcomeFingerprint,
      dismissedAt: Date.now(),
    }));
    persistDismissed([...dismissed, ...additions]);
  }
  function closeNotice(key: string) {
    setVisibleNotices((items) => items.filter((item) => item.key !== key));
  }
  function openDetails(record: UploadCenterRecord) {
    setDetail(record);
  }
  async function retryRetained(record: UploadCenterRecord) {
    if (record.kind === "image_replacement") return;
    await retryBackgroundUploadOperation(record.kind, record.id);
    await queue.refresh();
  }

  return (
    <>
      <section
        aria-label="Notificaciones de cargas"
        className="fixed right-5 top-5 z-40 flex w-[min(24rem,calc(100vw-2rem))] flex-col gap-2"
        aria-live="polite"
      >
        {visibleNotices.map(({ key, record, batchSummary }) => (
          <UploadOutcomeMessage
            key={key}
            operation={record}
            {...(batchSummary ? { batchSummary } : {})}
            onDismiss={() => closeNotice(key)}
            onDetails={() => openDetails(recordsById.get(record.id) ?? record)}
            onCenter={() => setOpen(true)}
            onRetry={() => void retryRetained(record)}
          />
        ))}
      </section>
      <UploadResultDialog
        open={resultQueue.length > 0}
        operation={resultQueue[0] ?? null}
        onOpenChange={(next) => {
          if (!next) setResultQueue((old) => old.slice(1));
        }}
        onCenter={() => setOpen(true)}
        onDetails={() => {
          const selected = resultQueue[0];
          if (selected) openDetails(recordsById.get(selected.id) ?? selected);
        }}
      />
      <UploadOperationDetailDialog
        open={detail !== null}
        operation={detail}
        onOpenChange={(next) => {
          if (!next) setDetail(null);
        }}
      />
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
              {tabRecords.length ? (
                <div className="divide-y divide-[var(--border-subtle)]">
                  {tabRecords.map((record) => (
                    <UploadCenterRow
                      key={`${record.kind}:${record.id}`}
                      record={record}
                      onDetails={() => openDetails(record)}
                      onDismiss={() => dismissRecord(record)}
                    />
                  ))}
                </div>
              ) : (
                <EmptyTab tab={tab} />
              )}
            </div>
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
                  onClick={() => dismissVisible(completed)}
                >
                  Limpiar completadas
                </Button>
              ) : null}
              {tab === "failed" ? (
                <Button
                  type="button"
                  variant="secondary"
                  size="sm"
                  disabled={!counts.failed}
                  onClick={() => dismissVisible(failed)}
                >
                  Limpiar errores
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

function UploadCenterRow({
  record,
  onDetails,
  onDismiss,
}: {
  record: UploadCenterRecord;
  onDetails(): void;
  onDismiss(): void;
}) {
  const queue = useUploadQueue();
  const fileInput = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [retryError, setRetryError] = useState(false);
  const progress = record.batchId
    ? queue.progressFor(record.batchId, record.id)
    : undefined;
  const retryable =
    record.retryable && record.status === "failed" && Boolean(record.batchId);
  const canRetrySame =
    record.status === "retry_exhausted" && record.kind !== "image_replacement";
  const canChangeChapter = Boolean(
    record.chapterId &&
      ["chapter-uploaded", "chapter-ready", "chapter-media-exists"].includes(
        record.errorCode ?? "",
      ),
  );
  const active = ![
    "ready",
    "completed",
    "rejected",
    "failed",
    "retry_exhausted",
    "terminal_failed",
  ].includes(record.status);
  return (
    <article className="flex gap-3 py-3 first:pt-0 last:pb-0">
      <span className="grid size-9 shrink-0 place-items-center rounded-control border border-[var(--border-subtle)] bg-surface text-primary">
        {["ready", "completed"].includes(record.status) ? (
          <Check aria-hidden="true" className="size-4 text-success" />
        ) : [
            "rejected",
            "failed",
            "retry_exhausted",
            "terminal_failed",
          ].includes(record.status) ? (
          <CircleAlert
            aria-hidden="true"
            className="size-4 text-destructive-text"
          />
        ) : (
          <FileArchive aria-hidden="true" className="size-4" />
        )}
      </span>
      <div className="min-w-0 flex-1">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="m-0 truncate text-sm font-semibold text-text">
              {record.seriesTitle}
              {record.chapterNumber === null
                ? ""
                : ` · Capítulo ${record.chapterNumber}`}
            </p>
            <p className="m-0 truncate text-xs text-secondary">
              {record.filename}
            </p>
          </div>
          <span
            className={`shrink-0 rounded-full px-2 py-1 text-xs ${summaryToneClass(uploadCenterSummary(record).tone)}`}
          >
            {uploadCenterSummary(record).label}
          </span>
        </div>
        <p className="m-0 mt-1 text-xs text-secondary">
          {formatActivityAt(record.activityAt)}
        </p>
        {active ? (
          <div className="mt-2">
            <div className="flex justify-between text-xs text-secondary">
              <span>{statusLabel(record.status)}</span>
              {progress === undefined ? null : <span>{progress}%</span>}
            </div>
            <ProgressBar
              value={progress ?? 0}
              label={`Progreso de ${record.filename}`}
            />
          </div>
        ) : null}
        <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-xs">
          {canLoadValidationReport(record) ? (
            <button
              type="button"
              className="text-primary underline"
              onClick={onDetails}
            >
              Ver detalles
            </button>
          ) : null}
          {retryable && record.batchId ? (
            <>
              <input
                ref={fileInput}
                className="sr-only"
                type="file"
                accept=".zip,application/zip,application/x-zip-compressed"
                onChange={(event) => {
                  const file = event.target.files?.[0];
                  if (file && record.batchId)
                    void queue.retryWithFile({
                      batchId: record.batchId,
                      seriesId: record.seriesId,
                      itemId: record.id,
                      file,
                    });
                  event.currentTarget.value = "";
                }}
              />
              <button
                type="button"
                className="text-primary underline"
                onClick={() => fileInput.current?.click()}
              >
                Reintentar ZIP
              </button>
            </>
          ) : null}
          {canRetrySame ? (
            <button
              type="button"
              disabled={busy}
              className="text-primary underline disabled:opacity-50"
              onClick={() => {
                setBusy(true);
                setRetryError(false);
                void retryBackgroundUploadOperation(
                  record.kind as
                    | "chapter_import"
                    | "chapter_upload"
                    | "chapter_replacement",
                  record.id,
                )
                  .then(() => queue.refresh())
                  .catch(() => setRetryError(true))
                  .finally(() => setBusy(false));
              }}
            >
              Reintentar procesamiento
            </button>
          ) : null}
          {retryError ? (
            <span role="alert" className="text-destructive-text">
              No se pudo solicitar el reintento.
            </span>
          ) : null}
          {canChangeChapter ? (
            <Link
              className="text-primary underline"
              href={`/series/${record.seriesId}/chapters`}
            >
              Cambiar capítulo
            </Link>
          ) : null}
          {!active ? (
            <button
              type="button"
              className="text-secondary underline"
              onClick={onDismiss}
            >
              Ocultar
            </button>
          ) : null}
        </div>
      </div>
    </article>
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

function EmptyTab({ tab }: { tab: Tab }) {
  const content = {
    active: [
      UploadCloud,
      "No hay cargas en progreso",
      "Aquí se mostrarán los archivos que estés subiendo en segundo plano.",
    ],
    completed: [
      Check,
      "No hay cargas completadas",
      "Las cargas finalizadas aparecerán aquí hasta que las ocultes.",
    ],
    failed: [
      CircleAlert,
      "No hay cargas con errores",
      "Los archivos que necesiten atención aparecerán aquí.",
    ],
  }[tab] as [typeof Check, string, string];
  const [Icon, title, copy] = content;
  return (
    <div className="grid h-full min-h-52 place-items-center rounded-control border border-[var(--border-subtle)] bg-surface px-6 text-center">
      <div className="grid max-w-xs justify-items-center gap-2">
        <span className="grid size-11 place-items-center rounded-full bg-accent-soft text-primary">
          <Icon aria-hidden="true" className="size-5" />
        </span>
        <p className="m-0 font-medium text-text">{title}</p>
        <p className="m-0 text-sm text-secondary">{copy}</p>
      </div>
    </div>
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
    (
      {
        pending: "En espera",
        pending_upload: "En espera",
        uploading: "Subiendo…",
        validating: "Validando archivo…",
        uploaded: "Archivo subido",
        processing: "Procesando…",
        completing: "Completando…",
        ready: "Completada",
        completed: "Completada",
        failed: "Error",
        rejected: "Rechazada",
        retry_exhausted: "Requiere atención",
        terminal_failed: "Error técnico",
      } as Record<string, string>
    )[status] ?? status
  );
}
function formatCreatedAt(value: string) {
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? ""
    : new Intl.DateTimeFormat("es-PE", {
        dateStyle: "short",
        timeStyle: "short",
      }).format(date);
}
function formatActivityAt(value: string) {
  const timestamp = Date.parse(value);
  if (!Number.isFinite(timestamp)) return "";
  const elapsed = Math.max(0, Date.now() - timestamp);
  if (elapsed < 60_000) return "Hace menos de un minuto";
  if (elapsed < 3_600_000)
    return `Hace ${Math.floor(elapsed / 60_000)} minutos`;
  if (elapsed < 86_400_000)
    return `Hace ${Math.floor(elapsed / 3_600_000)} horas`;
  return formatCreatedAt(value);
}
function summaryToneClass(tone: "success" | "warning" | "danger" | "info") {
  return {
    success: "bg-success/10 text-success",
    warning: "bg-warning/10 text-warning-text",
    danger: "bg-destructive-surface text-destructive-text",
    info: "bg-primary/10 text-primary",
  }[tone];
}
