import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import type { DomainEventEnvelope } from "../../apps/api/src/modules/events/application/domain-event-handler.js";
import type {
  NotificationRecord,
  NotificationRepository,
} from "../../apps/api/src/modules/notifications/application/notification.repository.js";
import { NotificationProjector } from "../../apps/api/src/modules/notifications/application/notification-projector.js";

class MemoryNotifications implements NotificationRepository {
  readonly rows: NotificationRecord[] = [];

  async createIfAbsent(
    input: Omit<NotificationRecord, "id" | "readAt" | "createdAt">,
  ) {
    const existing = this.rows.find(
      (row) =>
        row.userId === input.userId &&
        row.sourceEventId === input.sourceEventId,
    );
    if (existing) return { created: false, notification: existing };
    const notification: NotificationRecord = {
      ...input,
      id: randomUUID(),
      readAt: null,
      createdAt: new Date(),
    };
    this.rows.push(notification);
    return { created: true, notification };
  }

  async listForUser() {
    throw new Error("not implemented");
  }

  async countUnread() {
    throw new Error("not implemented");
  }

  async markRead() {
    throw new Error("not implemented");
  }

  async markAllRead() {
    throw new Error("not implemented");
  }
}

function event(
  overrides: Partial<DomainEventEnvelope> = {},
): DomainEventEnvelope {
  return {
    id: randomUUID(),
    eventType: "series.creation_grant.issued",
    aggregateType: "series_creation_grant",
    aggregateId: randomUUID(),
    actorUserId: null,
    payload: { targetUserId: randomUUID(), actorDiscordId: "not-projected" },
    occurredAt: new Date(),
    attemptCount: 0,
    ...overrides,
  };
}

describe("NotificationProjector", () => {
  it("creates one safe notification for the event target", async () => {
    const repository = new MemoryNotifications();
    const source = event();
    await new NotificationProjector(repository).handle(source);

    expect(repository.rows).toHaveLength(1);
    expect(repository.rows[0]).toMatchObject({
      userId: source.payload.targetUserId,
      sourceEventId: source.id,
      type: "series.creation_grant.issued",
      title: "Nueva autorización disponible",
      entityType: "series_creation_grant",
      entityId: source.aggregateId,
      actionKey: "authorizations",
    });
    expect(repository.rows[0]?.message).not.toContain("not-projected");
  });

  it("treats duplicate delivery as successful and idempotent", async () => {
    const repository = new MemoryNotifications();
    const projector = new NotificationProjector(repository);
    const source = event();
    await projector.handle(source);
    await projector.handle(source);
    expect(repository.rows).toHaveLength(1);
  });

  it("fails malformed supported events so the dispatcher can retry", async () => {
    const repository = new MemoryNotifications();
    await expect(
      new NotificationProjector(repository).handle(
        event({ payload: { targetUserId: "not-a-uuid" } }),
      ),
    ).rejects.toThrow();
    expect(repository.rows).toHaveLength(0);
  });
});
