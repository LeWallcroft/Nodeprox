import type { BackgroundUploadOperation } from "./background-operations";
import type { UploadCenterRecord } from "./upload-center-view-model";

const TTL_MS = 7 * 24 * 60 * 60 * 1000;
const MAX_ENTRIES = 500;

export type DismissedUploadOutcome = {
  operationId: string;
  fingerprint: string;
  dismissedAt: number;
};

export type UploadOutcomeNotice = { key: string; record: UploadCenterRecord };

export function observeUploadOutcomeTransitions(input: {
  operations: readonly BackgroundUploadOperation[];
  recordsById: ReadonlyMap<string, UploadCenterRecord>;
  previousStatuses: ReadonlyMap<string, string> | null;
  announcedKeys: Set<string>;
}): {
  currentStatuses: Map<string, string>;
  notices: readonly UploadOutcomeNotice[];
} {
  const currentStatuses = new Map(
    input.operations.map((operation) => [
      operation.id,
      `${operation.status}:${operation.warningCount}`,
    ]),
  );
  if (!input.previousStatuses) return { currentStatuses, notices: [] };
  const notices: UploadOutcomeNotice[] = [];
  for (const operation of input.operations) {
    const nextStatus = `${operation.status}:${operation.warningCount}`;
    if (
      input.previousStatuses.get(operation.id) === nextStatus ||
      !isTerminalUploadStatus(operation.status)
    )
      continue;
    const key = `${operation.id}:${operation.status}:${operation.warningCount}`;
    if (input.announcedKeys.has(key)) continue;
    const record = input.recordsById.get(operation.id);
    if (!record) continue;
    input.announcedKeys.add(key);
    notices.push({ key, record });
  }
  return { currentStatuses, notices };
}

export function fillOutcomeNoticeSlots(
  visible: readonly UploadOutcomeNotice[],
  pending: readonly UploadOutcomeNotice[],
  maximum = 3,
): {
  visible: readonly UploadOutcomeNotice[];
  pending: readonly UploadOutcomeNotice[];
} {
  const slots = Math.max(0, maximum - visible.length);
  return {
    visible: [...visible, ...pending.slice(0, slots)],
    pending: pending.slice(slots),
  };
}

export function uploadCenterDismissalStorageKey(userId: string): string {
  return `nodeprox:upload-center:dismissed:v1:${userId}`;
}

export function sanitizeDismissedUploadOutcomes(
  input: unknown,
  now: number,
): readonly DismissedUploadOutcome[] {
  if (!Array.isArray(input)) return [];
  const cutoff = now - TTL_MS;
  const valid = input.flatMap((value) => {
    if (!value || typeof value !== "object") return [];
    const candidate = value as Partial<DismissedUploadOutcome>;
    if (
      typeof candidate.operationId !== "string" ||
      typeof candidate.fingerprint !== "string" ||
      typeof candidate.dismissedAt !== "number" ||
      !Number.isFinite(candidate.dismissedAt) ||
      candidate.dismissedAt < cutoff ||
      candidate.dismissedAt > now
    )
      return [];
    return [
      {
        operationId: candidate.operationId,
        fingerprint: candidate.fingerprint,
        dismissedAt: candidate.dismissedAt,
      },
    ];
  });
  const newestByFingerprint = new Map<string, DismissedUploadOutcome>();
  for (const entry of valid) {
    const key = `${entry.operationId}\0${entry.fingerprint}`;
    const previous = newestByFingerprint.get(key);
    if (!previous || previous.dismissedAt < entry.dismissedAt)
      newestByFingerprint.set(key, entry);
  }
  return [...newestByFingerprint.values()]
    .sort((left, right) => right.dismissedAt - left.dismissedAt)
    .slice(0, MAX_ENTRIES);
}

export function isUploadOutcomeDismissed(
  operation: UploadCenterRecord,
  dismissed: readonly DismissedUploadOutcome[],
): boolean {
  if (!isTerminal(operation.status)) return false;
  return dismissed.some(
    (entry) =>
      entry.operationId === operation.id &&
      entry.fingerprint === operation.outcomeFingerprint,
  );
}

export function isTerminalUploadStatus(status: string): boolean {
  return [
    "ready",
    "completed",
    "rejected",
    "failed",
    "retry_exhausted",
    "terminal_failed",
  ].includes(status);
}

function isTerminal(status: string): boolean {
  return isTerminalUploadStatus(status);
}
