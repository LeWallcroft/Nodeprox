import type { DeleteChapterStorageInput } from "@nodeprox/types";

export interface ChapterDeletionOutboxPort {
  findPending(limit: number): Promise<DeleteChapterStorageInput[]>;
  markEnqueued(deletionId: string): Promise<void>;
}
