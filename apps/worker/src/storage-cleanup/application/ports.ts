export type StorageCleanupEffect = {
  id: string;
  replacementId: string;
  storageKey: string;
  reason: "replacement_source_zip" | "replacement_failed_candidate";
  attempts: number;
};

export interface StorageCleanupRepositoryPort {
  claimPending(limit: number): Promise<readonly StorageCleanupEffect[]>;
  isSafeToDelete(effect: StorageCleanupEffect): Promise<boolean>;
  markCompleted(effectId: string): Promise<void>;
  markRetry(effectId: string, availableAt: Date, code: string): Promise<void>;
  markFailed(effectId: string, code: string): Promise<void>;
}
