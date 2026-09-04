import type { MediaWarning } from "@nodeprox/types";

export const MAX_DIRECT_UPLOAD_CONCURRENCY = 3;

export type PersistedTrackedBatch = {
  batchId: string;
  seriesId: string;
  seriesTitle: string;
  trackedAt: number;
};

export function sanitizeTrackedBatches(
  value: unknown,
  cutoff: number,
): PersistedTrackedBatch[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((candidate) => {
    if (!candidate || typeof candidate !== "object") return [];
    const batch = candidate as Partial<PersistedTrackedBatch>;
    if (
      typeof batch.batchId !== "string" ||
      typeof batch.seriesId !== "string" ||
      typeof batch.seriesTitle !== "string" ||
      typeof batch.trackedAt !== "number" ||
      batch.trackedAt < cutoff
    )
      return [];
    return [
      {
        batchId: batch.batchId,
        seriesId: batch.seriesId,
        seriesTitle: batch.seriesTitle,
        trackedAt: batch.trackedAt,
      },
    ];
  });
}

export function safeBulkUploadConcurrency(value?: number): number {
  if (value === undefined || !Number.isInteger(value))
    return MAX_DIRECT_UPLOAD_CONCURRENCY;
  return Math.min(MAX_DIRECT_UPLOAD_CONCURRENCY, Math.max(1, value));
}

export function canEnqueueDirectUpload(input: {
  status: string;
  resolution: string | null;
  hasTransfer: boolean;
}): boolean {
  return (
    input.status === "uploading" &&
    (input.resolution === "created" || input.resolution === "reused") &&
    input.hasTransfer
  );
}

export async function runPool(
  jobs: readonly (() => Promise<void>)[],
  concurrency = MAX_DIRECT_UPLOAD_CONCURRENCY,
) {
  const effectiveConcurrency = safeBulkUploadConcurrency(concurrency);
  let cursor = 0;
  await Promise.all(
    Array.from(
      { length: Math.min(effectiveConcurrency, jobs.length) },
      async () => {
        while (cursor < jobs.length) {
          const job = jobs[cursor];
          cursor += 1;
          if (job) await job();
        }
      },
    ),
  );
}

export function mediaWarningLabel(warning: MediaWarning): string {
  switch (warning.code) {
    case "large-file":
      return `${warning.filename}: archivo grande`;
    case "wide-image":
      return `${warning.filename}: imagen muy ancha`;
    case "tall-image":
      return `${warning.filename}: imagen muy alta`;
  }
}
