import type { DeleteChapterStorageInput } from "@nodeprox/types";
import type { StorageExecutionResolver } from "@nodeprox/storage/profile-execution";
import type { ChapterDeletionRepositoryPort } from "./ports.js";

export class ChapterDeletionService {
  constructor(
    private readonly repository: ChapterDeletionRepositoryPort,
    private readonly storageExecution: StorageExecutionResolver,
  ) {}

  async execute(input: DeleteChapterStorageInput): Promise<void> {
    const work = await this.repository.load(input.deletionId, input.chapterId);
    if (!work) return;
    const uniqueObjects = new Map(
      work.storageObjects.map((object) => [
        JSON.stringify([object.storageProfileId, object.storageKey]),
        object,
      ]),
    );
    for (const object of uniqueObjects.values()) {
      const storage = await this.storageExecution.storageFor(
        object.storageProfileId,
      );
      await storage.delete(object.storageKey);
    }
    await this.repository.finalize(input.deletionId, input.chapterId);
  }
}
