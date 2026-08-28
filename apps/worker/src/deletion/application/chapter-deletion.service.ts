import type { DeleteChapterStorageInput } from "@nodeprox/types";
import type { StoragePort } from "@nodeprox/storage/port";
import type { ChapterDeletionRepositoryPort } from "./ports.js";

export class ChapterDeletionService {
  constructor(
    private readonly repository: ChapterDeletionRepositoryPort,
    private readonly storage: StoragePort,
  ) {}

  async execute(input: DeleteChapterStorageInput): Promise<void> {
    const work = await this.repository.load(input.deletionId, input.chapterId);
    if (!work) return;
    for (const key of new Set(work.storageKeys)) await this.storage.delete(key);
    await this.repository.finalize(input.deletionId, input.chapterId);
  }
}
