import type { ChapterReplacementResult } from "../../domain/chapter-replacement-result.js";

export type ActivateChapterReplacementInput = {
  replacementId: string;
  chapterId: string;
  actorUserId: string;
  requestId?: string;
};

export type ActivateChapterReplacementOutcome =
  | { outcome: "completed"; result: ChapterReplacementResult }
  | { outcome: "not-found" | "not-ready" | "in-progress" | "invalid" };

export interface ChapterMediaReplacementRepository {
  activate(
    input: ActivateChapterReplacementInput,
  ): Promise<ActivateChapterReplacementOutcome>;
}
