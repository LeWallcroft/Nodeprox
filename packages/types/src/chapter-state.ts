export const CHAPTER_STATES = [
  "draft",
  "uploading",
  "uploaded",
  "processing",
  "ready",
  "failed",
  "deleting",
] as const;

export type ChapterState = (typeof CHAPTER_STATES)[number];

export const CHAPTER_TRANSITIONS = [
  "start-upload",
  "complete-upload",
  "abort-upload",
  "start-processing",
  "retry-processing",
  "processing-retry",
  "processing-failed",
  "processing-succeeded",
  "request-deletion",
] as const;

export type ChapterTransition = (typeof CHAPTER_TRANSITIONS)[number];

export type ChapterTransitionDecision =
  | { allowed: true; from: ChapterState; to: ChapterState }
  | {
      allowed: false;
      code: "invalid-chapter-transition";
      from: ChapterState;
      transition: ChapterTransition;
    };

export type TransitionChapterStateInput = {
  chapterId: string;
  transition: ChapterTransition;
  expectedStates?: readonly ChapterState[];
};

export type TransitionChapterStateResult =
  | {
      transitioned: true;
      previousState: ChapterState;
      currentState: ChapterState;
    }
  | {
      transitioned: false;
      reason: "not-found" | "invalid-transition" | "concurrent-state-change";
      currentState?: ChapterState;
    };

export interface ChapterStateTransitionRepository {
  transitionChapterState(
    input: TransitionChapterStateInput,
  ): Promise<TransitionChapterStateResult>;
}

const transitionTargets: Partial<
  Record<ChapterState, Partial<Record<ChapterTransition, ChapterState>>>
> = {
  draft: { "start-upload": "uploading", "request-deletion": "deleting" },
  uploading: {
    "complete-upload": "uploaded",
    "abort-upload": "draft",
    "request-deletion": "deleting",
  },
  uploaded: {
    "start-processing": "processing",
    "request-deletion": "deleting",
  },
  processing: {
    "processing-retry": "uploaded",
    "processing-failed": "failed",
    "processing-succeeded": "ready",
  },
  ready: { "request-deletion": "deleting" },
  failed: {
    "start-upload": "uploading",
    "retry-processing": "processing",
    "request-deletion": "deleting",
  },
};

export function evaluateChapterTransition(
  state: ChapterState,
  transition: ChapterTransition,
): ChapterTransitionDecision {
  const to = transitionTargets[state]?.[transition];
  return to
    ? { allowed: true, from: state, to }
    : {
        allowed: false,
        code: "invalid-chapter-transition",
        from: state,
        transition,
      };
}
