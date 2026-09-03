export type CurrentMediaVersion = {
  id: string;
  version: number;
  physicalFilename: string;
  storageKey: string;
  extension: string;
  contentType: string;
  sizeBytes: number;
  checksum: string;
};

export type LockedLogicalImage = {
  id: string;
  chapterId: string;
  seriesSlug: string;
  chapterPublicKey: string;
  logicalFilename: string;
  current: CurrentMediaVersion;
};

export type NewMediaVersion = Omit<CurrentMediaVersion, "id">;

export interface MediaReplacementTransactionPort {
  readonly image: LockedLogicalImage;
  cutover(input: {
    operationId: string;
    actorId: string;
    requestId?: string;
    next: NewMediaVersion;
    oldPublicUrl: string;
  }): Promise<{ versionId: string }>;
}

export interface MediaReplacementRepositoryPort {
  findChapterId(imageId: string): Promise<string | null>;
  withLockedImage<T>(
    imageId: string,
    work: (transaction: MediaReplacementTransactionPort) => Promise<T>,
  ): Promise<T | null>;
  enqueueOrphanCleanup(input: {
    operationId: string;
    imageId: string;
    storageKey: string;
  }): Promise<void>;
}

export interface MediaReplacementObservabilityPort {
  orphanCandidate(input: {
    operationId: string;
    imageId: string;
    storageKey: string;
    errorName: string;
  }): void;
}
