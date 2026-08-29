"use client";

import { useEffect, useMemo, useState } from "react";
import { PageHeader } from "../../../components/layout/page-header";
import { Button } from "../../../components/ui/button";
import { errorMessage } from "../../../components/domains/feedback";
import { useSeriesList } from "../../../lib/domains/series/hooks";
import {
  abortImportItem,
  completeImportItem,
  createImportBatch,
  getImportBatch,
  retryImportItem,
} from "../../../lib/domains/ingestion/api";
import {
  mediaWarningLabel,
  runPool,
  safeBulkUploadConcurrency,
} from "../../../lib/domains/ingestion/orchestration";
import { useProductSettings } from "../../../lib/domains/settings/hooks";
import type { ImportCandidate } from "../../../lib/domains/ingestion/types";
import { putDirectUpload } from "../../../lib/domains/uploads/api";

export default function BulkUploadPage() {
  const series = useSeriesList();
  const settings = useProductSettings();
  const [seriesId, setSeriesId] = useState("");
  const [items, setItems] = useState<ImportCandidate[]>([]);
  const [batchId, setBatchId] = useState<string | null>(null);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const valid = useMemo(
    () =>
      items.length > 0 &&
      items.every((item) => item.chapterNumber !== null && item.file.size > 0),
    [items],
  );

  useEffect(() => {
    if (!batchId || running) return;
    const timer = window.setInterval(async () => {
      const projection = await getImportBatch(batchId).catch(() => null);
      if (!projection) return;
      setItems((current) =>
        current.map((item) => {
          const projected = projection.items.find(
            (candidate) => candidate.clientId === item.clientId,
          );
          if (!projected) return item;
          const next: ImportCandidate = {
            ...item,
            itemId: projected.itemId,
            status: projected.status,
            warnings: projected.warnings,
          };
          if (projected.chapterId) next.chapterId = projected.chapterId;
          if (projected.uploadId) next.uploadId = projected.uploadId;
          else delete next.uploadId;
          if (projected.errorCode) next.error = projected.errorCode;
          else delete next.error;
          return next;
        }),
      );
    }, 2000);
    return () => window.clearInterval(timer);
  }, [batchId, running]);

  function select(files: FileList | null) {
    if (!files) return;
    setBatchId(null);
    setItems(
      Array.from(files).map((file) => ({
        clientId: crypto.randomUUID(),
        file,
        chapterNumber: inferChapterNumber(file.name),
        status: "pending",
        progress: 0,
      })),
    );
  }

  async function start() {
    if (!seriesId || !valid) return;
    setRunning(true);
    setError(null);
    try {
      const batch = await createImportBatch(
        seriesId,
        items.map((item) => ({
          clientId: item.clientId,
          chapterNumber: item.chapterNumber as number,
          filename: item.file.name,
          contentType: "application/zip",
          sizeBytes: item.file.size,
        })),
      );
      setBatchId(batch.batchId);
      const jobs = batch.items
        .filter((item) => item.status === "uploading")
        .map((item) => async () => {
          const source = items.find(
            (candidate) => candidate.clientId === item.clientId,
          );
          if (!source || !("transfer" in item)) return;
          update(item.clientId, {
            itemId: item.itemId,
            status: "uploading",
            chapterId: item.chapterId,
            uploadId: item.uploadId,
          });
          try {
            await putDirectUpload(source.file, item.transfer, (progress) =>
              update(item.clientId, {
                progress: Math.round(
                  (progress.loadedBytes / progress.totalBytes) * 100,
                ),
              }),
            );
            await completeImportItem(item.chapterId, item.uploadId);
            update(item.clientId, { status: "uploaded", progress: 100 });
          } catch (cause) {
            await abortImportItem(item.chapterId, item.uploadId).catch(
              () => undefined,
            );
            update(item.clientId, {
              status: "failed",
              error: errorMessage(cause),
            });
          }
        });
      for (const failed of batch.items.filter(
        (item) => item.status === "failed",
      )) {
        const mutation: Partial<ImportCandidate> = {
          itemId: failed.itemId,
          status: "failed",
          error: failed.errorCode,
        };
        if (failed.chapterId) mutation.chapterId = failed.chapterId;
        update(failed.clientId, mutation);
      }
      const configured = settings.data?.sections
        .flatMap((section) => section.fields)
        .find((field) => field.key === "bulk_upload_concurrency")?.value;
      await runPool(
        jobs,
        safeBulkUploadConcurrency(
          typeof configured === "number" ? configured : undefined,
        ),
      );
    } catch (cause) {
      setError(errorMessage(cause, "No se pudo iniciar la carga masiva."));
    } finally {
      setRunning(false);
    }
  }

  async function retry(item: ImportCandidate) {
    if (!seriesId || !batchId || !item.itemId || !item.chapterId) return;
    let currentUpload: { chapterId: string; uploadId: string } | undefined;
    update(item.clientId, {
      status: "uploading",
      progress: 0,
    });
    clearError(item.clientId);
    try {
      const retried = await retryImportItem(seriesId, batchId, item.itemId, {
        contentType: "application/zip",
        sizeBytes: item.file.size,
      });
      currentUpload = {
        chapterId: retried.chapterId,
        uploadId: retried.uploadId,
      };
      update(item.clientId, {
        itemId: retried.itemId,
        chapterId: retried.chapterId,
        uploadId: retried.uploadId,
      });
      await putDirectUpload(item.file, retried.transfer, (progress) =>
        update(item.clientId, {
          progress: Math.round(
            (progress.loadedBytes / progress.totalBytes) * 100,
          ),
        }),
      );
      await completeImportItem(retried.chapterId, retried.uploadId);
      update(item.clientId, { status: "uploaded", progress: 100 });
    } catch (cause) {
      if (currentUpload)
        await abortImportItem(
          currentUpload.chapterId,
          currentUpload.uploadId,
        ).catch(() => undefined);
      update(item.clientId, {
        status: "failed",
        error: errorMessage(cause),
      });
    }
  }

  function update(clientId: string, mutation: Partial<ImportCandidate>) {
    setItems((current) =>
      current.map((item) =>
        item.clientId === clientId ? { ...item, ...mutation } : item,
      ),
    );
  }

  function clearError(clientId: string) {
    setItems((current) =>
      current.map((item) => {
        if (item.clientId !== clientId || !item.error) return item;
        const next = { ...item };
        delete next.error;
        return next;
      }),
    );
  }

  return (
    <>
      <PageHeader
        title="Carga masiva"
        description="Confirma el mapping; cada ZIP se carga directamente a B2 y se procesa de forma independiente."
        breadcrumbs={[
          { label: "Dashboard", href: "/" },
          { label: "Cargas", current: true },
        ]}
      />
      <section className="grid gap-4 rounded-xl border border-border bg-surface p-5">
        <label className="grid gap-1.5 text-sm font-semibold">
          Series
          <select
            value={seriesId}
            onChange={(event) => setSeriesId(event.target.value)}
          >
            <option value="">Selecciona una Series</option>
            {series.data?.map((item) => (
              <option key={item.id} value={item.id}>
                {item.title}
              </option>
            ))}
          </select>
        </label>
        <label className="grid gap-1.5 text-sm font-semibold">
          Archivos ZIP
          <input
            type="file"
            accept=".zip,application/zip,application/x-zip-compressed"
            multiple
            onChange={(event) => select(event.target.files)}
          />
        </label>
        {items.map((item) => (
          <div
            key={item.clientId}
            className="grid gap-2 rounded-lg border border-border p-3 md:grid-cols-[1fr_160px_120px_auto] md:items-center"
          >
            <span className="truncate">{item.file.name}</span>
            <input
              aria-label={`Chapter para ${item.file.name}`}
              type="number"
              min={1}
              step={1}
              value={item.chapterNumber ?? ""}
              disabled={running || item.status !== "pending"}
              onChange={(event) =>
                update(item.clientId, {
                  chapterNumber: event.target.value
                    ? Number(event.target.value)
                    : null,
                })
              }
            />
            <span className="text-sm text-muted">
              {item.status} · {item.progress}%
            </span>
            {item.status === "failed" &&
            item.chapterId &&
            item.itemId &&
            batchId ? (
              <Button type="button" onClick={() => void retry(item)}>
                Reintentar
              </Button>
            ) : null}
            {item.error ? (
              <p className="text-sm text-danger md:col-span-4">{item.error}</p>
            ) : null}
            {item.warnings?.length ? (
              <ul className="text-sm text-warning md:col-span-4">
                {item.warnings.map((warning) => (
                  <li key={`${warning.code}-${warning.filename}`}>
                    {mediaWarningLabel(warning)}
                  </li>
                ))}
              </ul>
            ) : null}
          </div>
        ))}
        {error ? <p className="text-sm text-danger">{error}</p> : null}
        <Button
          type="button"
          disabled={!seriesId || !valid || running}
          onClick={() => void start()}
        >
          {running ? "Cargando…" : "Iniciar carga"}
        </Button>
      </section>
    </>
  );
}

function inferChapterNumber(filename: string): number | null {
  const match = /^(\d+)\.zip$/i.exec(filename.trim());
  if (!match) return null;
  const value = Number(match[1]);
  return Number.isSafeInteger(value) && value > 0 ? value : null;
}
