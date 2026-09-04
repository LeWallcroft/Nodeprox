import type { ChapterReplacementItem } from "../../domain/chapter-replacement-item.js";

export interface ChapterReplacementManifestRepository {
  createItems(
    items: readonly Omit<
      ChapterReplacementItem,
      "resultImageId" | "resultImageVersionId" | "createdAt" | "updatedAt"
    >[],
  ): Promise<readonly ChapterReplacementItem[]>;
  findByOperationId(
    operationId: string,
  ): Promise<readonly ChapterReplacementItem[]>;
}
