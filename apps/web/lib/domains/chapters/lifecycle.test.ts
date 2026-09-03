import { describe, expect, it } from "vitest";
import {
  hasActiveChapterLifecycle,
  isChapterLifecycleActive,
  isImportBatchLifecycleActive,
} from "./lifecycle";

describe("Chapter lifecycle polling policy", () => {
  it("polls only persisted non-terminal Chapter lifecycle states", () => {
    expect(isChapterLifecycleActive("uploading")).toBe(true);
    expect(isChapterLifecycleActive("uploaded")).toBe(true);
    expect(isChapterLifecycleActive("processing")).toBe(true);
    expect(isChapterLifecycleActive("draft")).toBe(false);
    expect(isChapterLifecycleActive("ready")).toBe(false);
    expect(isChapterLifecycleActive("failed")).toBe(false);
  });

  it("keeps a Chapter list polling only while one Chapter is active", () => {
    expect(
      hasActiveChapterLifecycle([
        { status: "ready" },
        { status: "processing" },
      ]),
    ).toBe(true);
    expect(
      hasActiveChapterLifecycle([{ status: "ready" }, { status: "failed" }]),
    ).toBe(false);
  });

  it("keeps resolution separate from import item lifecycle", () => {
    expect(
      isImportBatchLifecycleActive({
        batchId: "batch-1",
        status: "running",
        items: [
          {
            itemId: "item-1",
            clientId: "client-1",
            chapterNumber: 1,
            filename: "chapter.zip",
            chapterId: "chapter-1",
            uploadId: "upload-1",
            status: "processing",
            errorCode: null,
            resolution: "reused",
            warnings: [],
          },
        ],
      }),
    ).toBe(true);
    expect(
      isImportBatchLifecycleActive({
        batchId: "batch-1",
        status: "completed_with_errors",
        items: [
          {
            itemId: "item-1",
            clientId: "client-1",
            chapterNumber: 1,
            filename: "chapter.zip",
            chapterId: "chapter-1",
            uploadId: null,
            status: "failed",
            errorCode: "chapter-processing",
            resolution: "conflict",
            warnings: [],
          },
        ],
      }),
    ).toBe(false);
  });
});
