import { describe, expect, it } from "vitest";
import { processingJobId } from "../../apps/api/src/modules/processing/infrastructure/queue/bullmq.processing.queue.js";

describe("processing queue identity", () => {
  it("deduplicates one upload dispatch without suppressing a later retry", () => {
    const chapterId = "chapter-id";
    expect(processingJobId({ chapterId, uploadId: "upload-a" })).toBe(
      "chapter-processing-chapter-id-upload-a-initial",
    );
    expect(processingJobId({ chapterId, uploadId: "upload-a" })).toBe(
      processingJobId({ chapterId, uploadId: "upload-a" }),
    );
    expect(processingJobId({ chapterId, uploadId: "upload-b" })).not.toBe(
      processingJobId({ chapterId, uploadId: "upload-a" }),
    );
    expect(
      processingJobId({ chapterId, uploadId: "upload-a", outboxId: "retry-2" }),
    ).not.toBe(processingJobId({ chapterId, uploadId: "upload-a" }));
  });
});
