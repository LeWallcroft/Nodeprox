export interface DomainEventEnvelope {
  id: string;
  eventType: string;
  aggregateType: string;
  aggregateId: string;
  actorUserId: string | null;
  payload: Record<string, unknown>;
  occurredAt: Date;
  attemptCount: number;
}

export interface DomainEventHandler {
  readonly handlerName: string;
  readonly eventTypes: readonly string[];

  handle(event: DomainEventEnvelope): Promise<void>;
}

export interface DomainEventHandlerRegistry {
  getHandlers(eventType: string): readonly DomainEventHandler[];
}

export class DefaultDomainEventHandlerRegistry
  implements DomainEventHandlerRegistry
{
  private readonly handlersByEventType = new Map<
    string,
    DomainEventHandler[]
  >();

  constructor(handlers: readonly DomainEventHandler[]) {
    for (const handler of handlers) {
      for (const eventType of handler.eventTypes) {
        const registered = this.handlersByEventType.get(eventType) ?? [];
        registered.push(handler);
        this.handlersByEventType.set(eventType, registered);
      }
    }
  }

  getHandlers(eventType: string): readonly DomainEventHandler[] {
    return this.handlersByEventType.get(eventType) ?? [];
  }
}
