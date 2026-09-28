export type MediaEffectType = "cdn_purge" | "storage_delete";

export type ClaimedMediaEffect = {
  id: string;
  effectType: MediaEffectType;
  imageId: string;
  target: string;
  storageProfileId: string;
  attempts: number;
};

export interface CdnInvalidationPort {
  purgeUrls(urls: readonly string[]): Promise<void>;
}

export class CdnInvalidationError extends Error {
  constructor(
    readonly code: string,
    readonly retryable: boolean,
  ) {
    super("CDN invalidation failed");
    this.name = "CdnInvalidationError";
  }
}

export interface MediaEffectRepositoryPort {
  claimPending(limit: number): Promise<readonly ClaimedMediaEffect[]>;
  isCurrentStorageKey(
    imageId: string,
    storageProfileId: string,
    storageKey: string,
  ): Promise<boolean>;
  markCompleted(effectId: string): Promise<void>;
  markRetry(effectId: string, availableAt: Date, code: string): Promise<void>;
  markFailed(effectId: string, code: string): Promise<void>;
}
