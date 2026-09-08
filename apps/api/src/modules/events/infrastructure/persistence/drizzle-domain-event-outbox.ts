import { domainEventOutbox } from "../../../../../../../database/schema/index.js";
import type { DomainEventOutbox } from "../../application/domain-event-outbox.js";

export class DrizzleDomainEventOutbox implements DomainEventOutbox {
  async append(
    event: Parameters<DomainEventOutbox["append"]>[0],
    tx: Parameters<DomainEventOutbox["append"]>[1],
  ) {
    await tx.insert(domainEventOutbox).values({
      eventType: event.type,
      aggregateType: event.aggregateType,
      aggregateId: event.aggregateId,
      ...(event.actorUserId ? { actorUserId: event.actorUserId } : {}),
      payload: event.payload,
      occurredAt: event.occurredAt,
    });
  }
}
