import type {
  TransitionChapterStateInput,
  TransitionChapterStateResult,
} from "@nodeprox/types";

/** Persistence boundary for the shared Chapter lifecycle transition contract. */
export interface ChapterStateTransitionRepository {
  transitionChapterState(
    input: TransitionChapterStateInput,
  ): Promise<TransitionChapterStateResult>;
}
