import type { NodeProxTransaction } from "../../authorization/infrastructure/persistence/drizzle/transactional-authorization.js";

export interface DomainEventOutbox {
  append(
    event: {
      type: string;
      aggregateType: string;
      aggregateId: string;
      actorUserId?: string | null | undefined;
      payload: Record<string, unknown>;
      occurredAt: Date;
    },
    tx: NodeProxTransaction,
  ): Promise<void>;
}
