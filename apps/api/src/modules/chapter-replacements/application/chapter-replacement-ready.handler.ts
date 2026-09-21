import { z } from "zod";
import type {
  DomainEventEnvelope,
  DomainEventHandler,
} from "../../events/application/domain-event-handler.js";
import type { ChapterMediaActivationService } from "./chapter-media-activation.service.js";

const payloadSchema = z.object({
  targetUserId: z.uuid(),
  chapterId: z.uuid(),
});

export class ChapterReplacementReadyHandler implements DomainEventHandler {
  readonly handlerName = "chapter-replacement-ready-handler";
  readonly eventTypes = ["chapter.replacement.ready"] as const;

  constructor(private readonly activation: ChapterMediaActivationService) {}

  async handle(event: DomainEventEnvelope): Promise<void> {
    const payload = payloadSchema.parse(event.payload);
    await this.activation.executeAuthorized({
      replacementId: event.aggregateId,
      chapterId: payload.chapterId,
      actorUserId: payload.targetUserId,
    });
  }
}
