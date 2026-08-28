import type { MediaWarning } from "@nodeprox/types";

export const MAX_DIRECT_UPLOAD_CONCURRENCY = 3;

export async function runPool(
  jobs: readonly (() => Promise<void>)[],
  concurrency = MAX_DIRECT_UPLOAD_CONCURRENCY,
) {
  let cursor = 0;
  await Promise.all(
    Array.from({ length: Math.min(concurrency, jobs.length) }, async () => {
      while (cursor < jobs.length) {
        const job = jobs[cursor];
        cursor += 1;
        if (job) await job();
      }
    }),
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
