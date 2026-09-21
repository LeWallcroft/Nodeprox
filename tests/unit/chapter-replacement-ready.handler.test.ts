import { randomUUID } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import { ChapterReplacementReadyHandler } from "../../apps/api/src/modules/chapter-replacements/application/chapter-replacement-ready.handler.js";

describe("ChapterReplacementReadyHandler", () => {
  it("activates a ready replacement with its persisted actor", async () => {
    const activation = { executeAuthorized: vi.fn(async () => undefined) };
    const handler = new ChapterReplacementReadyHandler(activation as never);
    const chapterId = randomUUID();
    const targetUserId = randomUUID();
    const replacementId = randomUUID();

    await handler.handle({
      id: randomUUID(),
      eventType: "chapter.replacement.ready",
      aggregateType: "chapter_replacement_operation",
      aggregateId: replacementId,
      actorUserId: targetUserId,
      payload: { targetUserId, chapterId },
      occurredAt: new Date(),
      attemptCount: 0,
    });

    expect(activation.executeAuthorized).toHaveBeenCalledWith({
      replacementId,
      chapterId,
      actorUserId: targetUserId,
    });
  });
});
