export type ChapterDeletionWork = {
  deletionId: string;
  chapterId: string;
  requestedBy: string;
  storageObjects: readonly { storageProfileId: string; storageKey: string }[];
};

export interface ChapterDeletionRepositoryPort {
  load(
    deletionId: string,
    chapterId: string,
  ): Promise<ChapterDeletionWork | null>;
  finalize(deletionId: string, chapterId: string): Promise<void>;
}
