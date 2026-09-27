export type ChapterReplacementProcessingContext = {
  replacementId: string;
  chapterId: string;
  requestedByUserId: string;
  sourceStorageKey: string;
  storageProfileId: string;
  seriesSlug: string;
  chapterPublicKey: string;
  status: "processing";
  activeImages: readonly {
    sortOrder: number;
    logicalFilename: string;
    currentVersion: number;
  }[];
};

export type ChapterReplacementManifestItem = {
  id: string;
  operationId: string;
  sortOrder: number;
  candidateStorageKey: string;
  storageProfileId: string;
  physicalFilename: string;
  originalFilename: string;
  contentType: string;
  sizeBytes: number;
  checksum: string;
  etag: string | null;
  storedAt: Date | null;
};

export type PlannedChapterReplacementItem = Omit<
  ChapterReplacementManifestItem,
  "etag" | "storedAt"
>;

export interface ChapterReplacementProcessingRepositoryPort {
  claimForProcessing(input: {
    replacementId: string;
    chapterId: string;
  }): Promise<
    | { outcome: "process"; context: ChapterReplacementProcessingContext }
    | { outcome: "noop" | "not-found" }
  >;
  createOrLoadManifest(
    replacementId: string,
    plan: readonly PlannedChapterReplacementItem[],
  ): Promise<readonly ChapterReplacementManifestItem[]>;
  markCandidateStored(input: {
    replacementId: string;
    itemId: string;
    sizeBytes: number;
    etag?: string;
    storedAt: Date;
  }): Promise<boolean>;
  markReady(replacementId: string, originRequestId?: string): Promise<boolean>;
  markFailed(
    replacementId: string,
    errorCode: string,
    originRequestId?: string,
  ): Promise<boolean>;
}
