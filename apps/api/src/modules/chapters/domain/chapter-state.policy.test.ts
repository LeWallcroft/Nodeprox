import { describe, expect, it } from "vitest";
import {
  CHAPTER_STATES,
  CHAPTER_TRANSITIONS,
  evaluateChapterTransition,
  type ChapterState,
  type ChapterTransition,
} from "./chapter-state.policy.js";

const allowed = [
  ["draft", "start-upload", "uploading"],
  ["failed", "start-upload", "uploading"],
  ["uploading", "complete-upload", "uploaded"],
  ["uploading", "abort-upload", "draft"],
  ["uploading", "reject-upload", "draft"],
  ["uploading", "fail-upload", "draft"],
  ["uploaded", "start-processing", "processing"],
  ["failed", "retry-processing", "processing"],
  ["processing", "processing-retry", "uploaded"],
  ["processing", "processing-failed", "failed"],
  ["processing", "processing-succeeded", "ready"],
  ["draft", "request-deletion", "deleting"],
  ["uploading", "request-deletion", "deleting"],
  ["uploaded", "request-deletion", "deleting"],
  ["ready", "request-deletion", "deleting"],
  ["failed", "request-deletion", "deleting"],
] as const satisfies readonly (readonly [
  ChapterState,
  ChapterTransition,
  ChapterState,
])[];

describe("evaluateChapterTransition", () => {
  it.each(allowed)("allows %s + %s -> %s", (from, transition, to) => {
    expect(evaluateChapterTransition(from, transition)).toEqual({
      allowed: true,
      from,
      to,
    });
  });

  it("denies every transition outside the canonical matrix", () => {
    const allowedKeys = new Set(
      allowed.map(([state, transition]) => `${state}:${transition}`),
    );
    for (const state of CHAPTER_STATES) {
      for (const transition of CHAPTER_TRANSITIONS) {
        if (allowedKeys.has(`${state}:${transition}`)) continue;
        expect(evaluateChapterTransition(state, transition)).toEqual({
          allowed: false,
          code: "invalid-chapter-transition",
          from: state,
          transition,
        });
      }
    }
  });
});
