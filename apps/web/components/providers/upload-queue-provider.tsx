"use client";

import {
  type Query,
  useQueries,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { isImportBatchLifecycleActive } from "../../lib/domains/chapters/lifecycle";
import { invalidateChapterLifecycle } from "../../lib/domains/chapters/lifecycle-invalidation";
import {
  abortImportItem,
  completeImportItem,
  createImportBatch,
  getImportBatch,
  retryImportItem,
} from "../../lib/domains/ingestion/api";
import {
  canEnqueueDirectUpload,
  MAX_DIRECT_UPLOAD_CONCURRENCY,
  type PersistedTrackedBatch,
  safeBulkUploadConcurrency,
  sanitizeTrackedBatches,
} from "../../lib/domains/ingestion/orchestration";
import type {
  CreatedImportBatch,
  ImportBatchProjection,
  ImportCandidate,
  RetriedImportItem,
} from "../../lib/domains/ingestion/types";
import { queryKeys } from "../../lib/domains/query-keys";
import { useProductSettings } from "../../lib/domains/settings/hooks";
import { putDirectUpload } from "../../lib/domains/uploads/api";
import {
  type BackgroundUploadOperation,
  listBackgroundUploadOperations,
} from "../../lib/domains/uploads/background-operations";

const STORAGE_KEY = "nodeprox:upload-queue:v1";
const TRACKED_BATCH_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;

type TrackedBatch = PersistedTrackedBatch;

export type UploadCenterBatch = TrackedBatch & {
  projection: ImportBatchProjection | null;
};

type TransferSession = {
  chapterId: string;
  uploadId: string;
  resolution: "created" | "reused";
  transfer: Parameters<typeof putDirectUpload>[1];
};

type TransferJob = TransferSession & {
  batchId: string;
  seriesId: string;
  itemId: string;
  clientId: string;
  file: File;
};

type QueueCandidate = Pick<
  ImportCandidate,
  "clientId" | "file" | "chapterNumber"
>;

type UploadQueueContextValue = {
  batches: readonly UploadCenterBatch[];
  operations: readonly BackgroundUploadOperation[];
  activeTransfers: number;
  queuedTransfers: number;
  progressFor(batchId: string, itemId: string): number | undefined;
  startBatch(input: {
    seriesId: string;
    seriesTitle: string;
    items: readonly QueueCandidate[];
  }): Promise<CreatedImportBatch>;
  retryWithFile(input: {
    batchId: string;
    seriesId: string;
    itemId: string;
    file: File;
  }): Promise<void>;
  abortTransfer(input: {
    batchId: string;
    chapterId: string;
    uploadId: string;
  }): Promise<void>;
  refreshBatch(batchId: string): Promise<void>;
  refresh(): Promise<void>;
};

const UploadQueueContext = createContext<UploadQueueContextValue | null>(null);

export function UploadQueueProvider({ children }: { children: ReactNode }) {
  const settings = useProductSettings();
  const queryClient = useQueryClient();
  const [tracked, setTracked] = useState<TrackedBatch[]>([]);
  const [hydrated, setHydrated] = useState(false);
  const [progress, setProgress] = useState<Readonly<Record<string, number>>>(
    {},
  );
  const [activeTransfers, setActiveTransfers] = useState(0);
  const [queuedTransfers, setQueuedTransfers] = useState(0);
  const queue = useRef<TransferJob[]>([]);
  const active = useRef(0);
  const drain = useRef<() => void>(() => undefined);
  const previousProjections = useRef<
    Readonly<Record<string, ImportBatchProjection>>
  >({});
  const previousOperationStatuses = useRef<Readonly<Record<string, string>>>(
    {},
  );

  const concurrency = useMemo(() => {
    const value = settings.data?.sections
      .flatMap((section) => section.fields)
      .find((field) => field.key === "bulk_upload_concurrency")?.value;
    return safeBulkUploadConcurrency(
      typeof value === "number" ? value : MAX_DIRECT_UPLOAD_CONCURRENCY,
    );
  }, [settings.data]);

  const operationsQuery = useQuery({
    queryKey: queryKeys.uploads.operations,
    queryFn: listBackgroundUploadOperations,
    refetchInterval: (query) =>
      query.state.data?.items.some((item) =>
        [
          "pending",
          "pending_upload",
          "uploading",
          "uploaded",
          "processing",
          "completing",
        ].includes(item.status),
      )
        ? 2000
        : 15000,
  });
  const refreshOperations = operationsQuery.refetch;

  const batchQueries = useQueries({
    queries: tracked.map((batch) => ({
      queryKey: queryKeys.ingestion.batch(batch.batchId),
      queryFn: () => getImportBatch(batch.batchId),
      retry: false,
      refetchOnMount: "always" as const,
      refetchInterval: (
        query: Query<
          ImportBatchProjection,
          Error,
          ImportBatchProjection,
          readonly unknown[]
        >,
      ) => (isImportBatchLifecycleActive(query.state.data) ? 2000 : false),
    })),
  });

  const projections = useMemo<Readonly<Record<string, ImportBatchProjection>>>(
    () =>
      Object.fromEntries(
        tracked.flatMap((batch, index) => {
          const projection = batchQueries[index]?.data;
          return projection ? [[batch.batchId, projection]] : [];
        }),
      ),
    [batchQueries, tracked],
  );

  const refreshBatch = useCallback(
    async (batchId: string) => {
      await queryClient.fetchQuery({
        queryKey: queryKeys.ingestion.batch(batchId),
        queryFn: () => getImportBatch(batchId),
        staleTime: 0,
      });
    },
    [queryClient],
  );

  const refresh = useCallback(async () => {
    await Promise.all([
      ...tracked.map((batch) => refreshBatch(batch.batchId)),
      refreshOperations(),
    ]);
  }, [refreshBatch, refreshOperations, tracked]);

  const executeTransfer = useCallback(
    async (job: TransferJob) => {
      const key = progressKey(job.batchId, job.itemId);
      setProgress((current) => ({ ...current, [key]: 0 }));
      try {
        await putDirectUpload(job.file, job.transfer, (value) =>
          setProgress((current) => ({
            ...current,
            [key]: Math.round((value.loadedBytes / value.totalBytes) * 100),
          })),
        );
        await completeImportItem(job.chapterId, job.uploadId);
        setProgress((current) => ({ ...current, [key]: 100 }));
      } catch {
        await abortImportItem(job.chapterId, job.uploadId).catch(
          () => undefined,
        );
      } finally {
        await refreshBatch(job.batchId).catch(() => undefined);
      }
    },
    [refreshBatch],
  );

  useEffect(() => {
    drain.current = () => {
      while (active.current < concurrency && queue.current.length) {
        const job = queue.current.shift();
        if (!job) return;
        active.current += 1;
        setActiveTransfers(active.current);
        setQueuedTransfers(queue.current.length);
        void executeTransfer(job).finally(() => {
          active.current -= 1;
          setActiveTransfers(active.current);
          setQueuedTransfers(queue.current.length);
          drain.current();
        });
      }
    };
    drain.current();
  }, [concurrency, executeTransfer]);

  const enqueue = useCallback((job: TransferJob) => {
    queue.current.push(job);
    setQueuedTransfers(queue.current.length);
    drain.current();
  }, []);

  useEffect(() => {
    try {
      const persisted = JSON.parse(
        window.localStorage.getItem(STORAGE_KEY) ?? "[]",
      ) as unknown;
      const cutoff = Date.now() - TRACKED_BATCH_MAX_AGE_MS;
      setTracked(sanitizeTrackedBatches(persisted, cutoff));
    } catch {
      window.localStorage.removeItem(STORAGE_KEY);
    } finally {
      setHydrated(true);
    }
  }, []);

  useEffect(() => {
    if (!hydrated) return;
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(tracked));
  }, [hydrated, tracked]);

  useEffect(() => {
    for (const batch of tracked) {
      const current = projections[batch.batchId];
      const previous = previousProjections.current[batch.batchId];
      if (!current || sameImportItemLifecycle(previous, current)) continue;
      for (const item of current.items)
        void invalidateChapterLifecycle(queryClient, {
          seriesId: batch.seriesId,
          chapterId: item.chapterId,
        });
    }
    previousProjections.current = projections;
  }, [projections, queryClient, tracked]);

  useEffect(() => {
    const operations = operationsQuery.data?.items ?? [];
    for (const operation of operations) {
      const previous = previousOperationStatuses.current[operation.id];
      if (
        previous &&
        previous !== operation.status &&
        ["ready", "completed", "failed"].includes(operation.status)
      )
        void invalidateChapterLifecycle(queryClient, {
          seriesId: operation.seriesId,
          chapterId: operation.chapterId,
        });
    }
    previousOperationStatuses.current = Object.fromEntries(
      operations.map((operation) => [operation.id, operation.status]),
    );
  }, [operationsQuery.data, queryClient]);

  const track = useCallback((batch: TrackedBatch) => {
    setTracked((current) => {
      const withoutCurrent = current.filter(
        (candidate) => candidate.batchId !== batch.batchId,
      );
      return [...withoutCurrent, batch];
    });
  }, []);

  const startBatch = useCallback(
    async (input: {
      seriesId: string;
      seriesTitle: string;
      items: readonly QueueCandidate[];
    }) => {
      const batch = await createImportBatch(
        input.seriesId,
        input.items.map((item) => ({
          clientId: item.clientId,
          chapterNumber: item.chapterNumber as number,
          filename: item.file.name,
          contentType: canonicalZipMime(item.file),
          sizeBytes: item.file.size,
        })),
      );
      const projection = projectionFromCreated(batch, input.items);
      track({
        batchId: batch.batchId,
        seriesId: input.seriesId,
        seriesTitle: input.seriesTitle,
        trackedAt: Date.now(),
      });
      queryClient.setQueryData(
        queryKeys.ingestion.batch(batch.batchId),
        projection,
      );
      await Promise.all(
        projection.items.map((item) =>
          invalidateChapterLifecycle(queryClient, {
            seriesId: input.seriesId,
            chapterId: item.chapterId,
          }),
        ),
      );
      for (const item of batch.items) {
        if (
          !canEnqueueDirectUpload({
            status: item.status,
            resolution: item.resolution,
            hasTransfer: "transfer" in item,
          }) ||
          !("transfer" in item)
        )
          continue;
        const candidate = input.items.find(
          (source) => source.clientId === item.clientId,
        );
        if (!candidate) continue;
        enqueue({
          batchId: batch.batchId,
          seriesId: input.seriesId,
          itemId: item.itemId,
          clientId: item.clientId,
          file: candidate.file,
          chapterId: item.chapterId,
          uploadId: item.uploadId,
          resolution: item.resolution,
          transfer: item.transfer,
        });
      }
      return batch;
    },
    [enqueue, queryClient, track],
  );

  const retryWithFile = useCallback(
    async (input: {
      batchId: string;
      seriesId: string;
      itemId: string;
      file: File;
    }) => {
      const session = await retryImportItem(
        input.seriesId,
        input.batchId,
        input.itemId,
        {
          contentType: canonicalZipMime(input.file),
          sizeBytes: input.file.size,
        },
      );
      enqueueRetry(input, session, enqueue);
      await refreshBatch(input.batchId).catch(() => undefined);
    },
    [enqueue, refreshBatch],
  );

  const abortTransfer = useCallback(
    async (input: { batchId: string; chapterId: string; uploadId: string }) => {
      await abortImportItem(input.chapterId, input.uploadId);
      await refreshBatch(input.batchId);
    },
    [refreshBatch],
  );

  const batches = useMemo(
    () =>
      [...tracked]
        .sort((left, right) => right.trackedAt - left.trackedAt)
        .map((batch) => ({
          ...batch,
          projection: projections[batch.batchId] ?? null,
        })),
    [projections, tracked],
  );

  const value = useMemo<UploadQueueContextValue>(
    () => ({
      batches,
      operations: operationsQuery.data?.items ?? [],
      activeTransfers,
      queuedTransfers,
      progressFor: (batchId, itemId) => progress[progressKey(batchId, itemId)],
      startBatch,
      retryWithFile,
      abortTransfer,
      refreshBatch,
      refresh,
    }),
    [
      abortTransfer,
      activeTransfers,
      batches,
      operationsQuery.data?.items,
      progress,
      queuedTransfers,
      refreshBatch,
      refresh,
      retryWithFile,
      startBatch,
    ],
  );
  return (
    <UploadQueueContext.Provider value={value}>
      {children}
    </UploadQueueContext.Provider>
  );
}

export function useUploadQueue() {
  const context = useContext(UploadQueueContext);
  if (!context)
    throw new Error("useUploadQueue must be used within UploadQueueProvider");
  return context;
}

function projectionFromCreated(
  batch: CreatedImportBatch,
  candidates: readonly QueueCandidate[],
): ImportBatchProjection {
  return {
    batchId: batch.batchId,
    status: batch.status,
    items: batch.items.map((item) => ({
      itemId: item.itemId,
      clientId: item.clientId,
      chapterNumber: item.chapterNumber,
      chapterId: item.chapterId ?? null,
      uploadId: "uploadId" in item ? item.uploadId : null,
      status: item.status,
      errorCode: "errorCode" in item ? item.errorCode : null,
      resolution: item.resolution,
      warnings: [],
      filename:
        candidates.find((candidate) => candidate.clientId === item.clientId)
          ?.file.name ?? "ZIP",
    })),
  };
}

function enqueueRetry(
  input: { batchId: string; seriesId: string; itemId: string; file: File },
  session: RetriedImportItem,
  enqueue: (job: TransferJob) => void,
) {
  enqueue({
    batchId: input.batchId,
    seriesId: input.seriesId,
    itemId: session.itemId,
    clientId: session.clientId,
    file: input.file,
    chapterId: session.chapterId,
    uploadId: session.uploadId,
    resolution: session.resolution,
    transfer: session.transfer,
  });
}

function canonicalZipMime(file: File) {
  return file.type === "application/x-zip-compressed"
    ? "application/zip"
    : "application/zip";
}

function progressKey(batchId: string, itemId: string) {
  return `${batchId}:${itemId}`;
}

function sameImportItemLifecycle(
  previous: ImportBatchProjection | undefined,
  current: ImportBatchProjection,
) {
  if (!previous || previous.items.length !== current.items.length) return false;
  const previousById = new Map(
    previous.items.map((item) => [item.itemId, item]),
  );
  return current.items.every((item) => {
    const previousItem = previousById.get(item.itemId);
    return (
      previousItem?.status === item.status &&
      previousItem.resolution === item.resolution &&
      previousItem.errorCode === item.errorCode &&
      previousItem.chapterId === item.chapterId
    );
  });
}
