import type { AuthorizationContext } from "../../../authorization/domain/authorization.types.js";
import type { ChapterCoreRecord } from "../../../series/domain/series.types.js";

export type ChapterMutationFailure =
  | { outcome: "denied" }
  | { outcome: "not-found" }
  | { outcome: "conflict" };

export interface ChapterMutationBoundaryPort {
  updateIfAuthorized(input: {
    actor: AuthorizationContext;
    chapterId: string;
    expectedChapterNumber: number;
    mutation: {
      chapterNumber?: number | undefined;
      title?: string | null | undefined;
    };
  }): Promise<
    { outcome: "updated"; chapter: ChapterCoreRecord } | ChapterMutationFailure
  >;
  deleteIfAuthorized(input: {
    actor: AuthorizationContext;
    chapterId: string;
  }): Promise<
    | { outcome: "deletion-requested"; deletionId: string }
    | ChapterMutationFailure
  >;
}
