import { and, eq } from "drizzle-orm";
import {
  evaluateChapterTransition,
  type TransitionChapterStateInput,
  type TransitionChapterStateResult,
} from "../packages/types/src/chapter-state.js";
import type { NodeProxTransaction } from "./client.js";
import { chapters } from "./schema/index.js";

export async function transitionChapterState(
  tx: NodeProxTransaction,
  input: TransitionChapterStateInput,
): Promise<TransitionChapterStateResult> {
  const [chapter] = await tx
    .select({ status: chapters.status })
    .from(chapters)
    .where(eq(chapters.id, input.chapterId))
    .limit(1)
    .for("update");
  if (!chapter) return { transitioned: false, reason: "not-found" };
  if (
    input.expectedStates !== undefined &&
    !input.expectedStates.includes(chapter.status)
  )
    return {
      transitioned: false,
      reason: "concurrent-state-change",
      currentState: chapter.status,
    };

  const decision = evaluateChapterTransition(chapter.status, input.transition);
  if (!decision.allowed)
    return {
      transitioned: false,
      reason: "invalid-transition",
      currentState: chapter.status,
    };

  const [updated] = await tx
    .update(chapters)
    .set({ status: decision.to, updatedAt: new Date() })
    .where(
      and(eq(chapters.id, input.chapterId), eq(chapters.status, decision.from)),
    )
    .returning({ status: chapters.status });
  return updated
    ? {
        transitioned: true,
        previousState: decision.from,
        currentState: updated.status,
      }
    : {
        transitioned: false,
        reason: "concurrent-state-change",
        currentState: chapter.status,
      };
}
