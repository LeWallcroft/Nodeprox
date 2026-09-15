import { randomUUID } from "node:crypto";
import { and, eq, inArray, isNull } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, inject, it } from "vitest";
import { buildApp } from "../../apps/api/src/app.js";
import { Argon2PasswordHasher } from "../../apps/api/src/modules/authentication/index.js";
import { DomainEventDispatcher } from "../../apps/api/src/modules/events/application/domain-event-dispatcher.js";
import { DefaultDomainEventHandlerRegistry } from "../../apps/api/src/modules/events/application/domain-event-handler.js";
import { DrizzleDomainEventOutboxRepository } from "../../apps/api/src/modules/events/infrastructure/persistence/drizzle-domain-event-outbox.repository.js";
import { NotificationProjector } from "../../apps/api/src/modules/notifications/application/notification-projector.js";
import { DrizzleNotificationRepository } from "../../apps/api/src/modules/notifications/infrastructure/persistence/drizzle-notification.repository.js";
import { createDatabase } from "../../database/client.js";
import {
  domainEventOutbox,
  notifications,
  users,
} from "../../database/schema/index.js";

const infrastructure = inject("infrastructure");
const database = createDatabase(infrastructure.databaseUrl);
const repository = new DrizzleNotificationRepository(database.db);
const app = buildApp(
  { logger: false },
  { database: database.db, secureCookie: false },
);
const password = "notification-inbox-password";
const firstUserId = randomUUID();
const secondUserId = randomUUID();
const firstEmail = `notification-first-${firstUserId}@example.com`;
const secondEmail = `notification-second-${secondUserId}@example.com`;
const notificationIds: string[] = [];
const eventIds: string[] = [];

async function login(email: string) {
  const response = await app.inject({
    method: "POST",
    url: "/auth/login",
    payload: { email, password },
  });
  expect(response.statusCode).toBe(204);
  const cookie = response.headers["set-cookie"];
  return Array.isArray(cookie) ? cookie[0] : cookie;
}

async function createNotification(input: {
  userId: string;
  sourceEventId?: string;
  createdAt?: Date;
}) {
  const result = await repository.createIfAbsent({
    userId: input.userId,
    sourceEventId: input.sourceEventId ?? randomUUID(),
    type: "series.creation_grant.issued",
    title: "Nueva autorización disponible",
    message: "Tienes una nueva autorización disponible para crear una Serie.",
    entityType: "series_creation_grant",
    entityId: randomUUID(),
    actionKey: "authorizations",
  });
  notificationIds.push(result.notification.id);
  if (input.createdAt)
    await database.db
      .update(notifications)
      .set({ createdAt: input.createdAt })
      .where(eq(notifications.id, result.notification.id));
  return result.notification.id;
}

beforeAll(async () => {
  await app.ready();
  const hasher = new Argon2PasswordHasher();
  await database.db.insert(users).values([
    {
      id: firstUserId,
      email: firstEmail,
      passwordHash: await hasher.hash(password),
      status: "active",
      role: "uploader",
    },
    {
      id: secondUserId,
      email: secondEmail,
      passwordHash: await hasher.hash(password),
      status: "active",
      role: "uploader",
    },
  ]);
});

afterAll(async () => {
  if (notificationIds.length > 0)
    await database.db
      .delete(notifications)
      .where(inArray(notifications.id, notificationIds));
  if (eventIds.length > 0)
    await database.db
      .delete(domainEventOutbox)
      .where(inArray(domainEventOutbox.id, eventIds));
  await database.db
    .delete(users)
    .where(inArray(users.id, [firstUserId, secondUserId]));
  await app.close();
  await database.sql.end();
});

describe("Notification inbox", () => {
  it("projects through the dispatcher once and completes a replay without duplicate inbox rows", async () => {
    const eventId = randomUUID();
    eventIds.push(eventId);
    await database.db.insert(domainEventOutbox).values({
      id: eventId,
      eventType: "series.creation_grant.issued",
      aggregateType: "series_creation_grant",
      aggregateId: randomUUID(),
      payload: { targetUserId: firstUserId },
      occurredAt: new Date("1970-01-01T00:00:01.000Z"),
    });
    const dispatcher = new DomainEventDispatcher(
      new DrizzleDomainEventOutboxRepository(database.db),
      new DefaultDomainEventHandlerRegistry([
        new NotificationProjector(repository),
      ]),
      { debug() {}, warn() {}, error() {} },
      { batchSize: 1 },
    );

    await expect(dispatcher.runOnce()).resolves.toMatchObject({
      claimed: 1,
      processed: 1,
    });
    const [firstDelivery] = await database.db
      .select({ processedAt: domainEventOutbox.processedAt })
      .from(domainEventOutbox)
      .where(eq(domainEventOutbox.id, eventId));
    expect(firstDelivery?.processedAt).toBeInstanceOf(Date);

    // Simulates a crash after the idempotent projection but before completion.
    await database.db
      .update(domainEventOutbox)
      .set({ processedAt: null, nextAttemptAt: null })
      .where(eq(domainEventOutbox.id, eventId));
    await expect(dispatcher.runOnce()).resolves.toMatchObject({
      claimed: 1,
      processed: 1,
    });
    const rows = await database.db
      .select({ id: notifications.id })
      .from(notifications)
      .where(
        and(
          eq(notifications.userId, firstUserId),
          eq(notifications.sourceEventId, eventId),
        ),
      );
    notificationIds.push(...rows.map((row) => row.id));
    expect(rows).toHaveLength(1);
  });

  it("leaves a malformed supported event retryable", async () => {
    const eventId = randomUUID();
    eventIds.push(eventId);
    await database.db.insert(domainEventOutbox).values({
      id: eventId,
      eventType: "series.creation_grant.issued",
      aggregateType: "series_creation_grant",
      aggregateId: randomUUID(),
      payload: { targetUserId: "malformed" },
      occurredAt: new Date("1970-01-01T00:00:02.000Z"),
    });
    const dispatcher = new DomainEventDispatcher(
      new DrizzleDomainEventOutboxRepository(database.db),
      new DefaultDomainEventHandlerRegistry([
        new NotificationProjector(repository),
      ]),
      { debug() {}, warn() {}, error() {} },
      { batchSize: 1 },
    );
    await expect(dispatcher.runOnce()).resolves.toMatchObject({
      claimed: 1,
      failed: 1,
    });
    const [stored] = await database.db
      .select({
        processedAt: domainEventOutbox.processedAt,
        attemptCount: domainEventOutbox.attemptCount,
      })
      .from(domainEventOutbox)
      .where(
        and(
          eq(domainEventOutbox.id, eventId),
          isNull(domainEventOutbox.processedAt),
        ),
      );
    expect(stored?.attemptCount).toBe(1);
  });

  it("projects an issued grant exactly once across duplicate delivery", async () => {
    const eventId = randomUUID();
    const projector = new NotificationProjector(repository);
    const source = {
      id: eventId,
      eventType: "series.creation_grant.issued",
      aggregateType: "series_creation_grant",
      aggregateId: randomUUID(),
      actorUserId: null,
      payload: { targetUserId: firstUserId, guildId: "not-persisted" },
      occurredAt: new Date(),
      attemptCount: 0,
    };
    await projector.handle(source);
    await projector.handle(source);
    const rows = await database.db
      .select()
      .from(notifications)
      .where(
        and(
          eq(notifications.userId, firstUserId),
          eq(notifications.sourceEventId, eventId),
        ),
      );
    notificationIds.push(...rows.map((row) => row.id));
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      actionKey: "authorizations",
      entityType: "series_creation_grant",
    });
    expect(JSON.stringify(rows[0])).not.toContain("not-persisted");
  });

  it("lists only the authenticated inbox, paginates deterministically, and preserves read idempotency", async () => {
    const oldest = await createNotification({
      userId: firstUserId,
      createdAt: new Date("2096-09-01T00:00:00.000Z"),
    });
    const newest = await createNotification({
      userId: firstUserId,
      createdAt: new Date("2096-09-03T00:00:00.000Z"),
    });
    await createNotification({ userId: secondUserId });
    const cookie = await login(firstEmail);

    const page = await app.inject({
      method: "GET",
      url: "/me/notifications?limit=1",
      headers: { cookie },
    });
    expect(page.statusCode).toBe(200);
    expect(page.json().items).toHaveLength(1);
    expect(page.json().items[0]?.id).toBe(newest);
    expect(page.json().nextCursor).toEqual(expect.any(String));
    expect(page.body).not.toContain(secondUserId);

    const secondPage = await app.inject({
      method: "GET",
      url: `/me/notifications?limit=10&cursor=${encodeURIComponent(page.json().nextCursor)}`,
      headers: { cookie },
    });
    expect(
      secondPage.json().items.map((item: { id: string }) => item.id),
    ).toContain(oldest);

    const unread = await app.inject({
      method: "GET",
      url: "/me/notifications/unread-count",
      headers: { cookie },
    });
    expect(unread.json().count).toBeGreaterThanOrEqual(2);
    await expect(
      app.inject({
        method: "PATCH",
        url: `/me/notifications/${newest}/read`,
        headers: { cookie },
      }),
    ).resolves.toMatchObject({ statusCode: 200 });
    await expect(
      app.inject({
        method: "PATCH",
        url: `/me/notifications/${newest}/read`,
        headers: { cookie },
      }),
    ).resolves.toMatchObject({ statusCode: 200 });
  });

  it("does not allow another user to read or bulk-update this inbox", async () => {
    const own = await createNotification({ userId: firstUserId });
    const firstCookie = await login(firstEmail);
    const secondCookie = await login(secondEmail);
    const crossUser = await app.inject({
      method: "PATCH",
      url: `/me/notifications/${own}/read`,
      headers: { cookie: secondCookie },
    });
    expect(crossUser.statusCode).toBe(404);
    const readAll = await app.inject({
      method: "POST",
      url: "/me/notifications/read-all",
      headers: { cookie: firstCookie },
    });
    expect(readAll.statusCode).toBe(200);
    const [foreign] = await database.db
      .select({ readAt: notifications.readAt })
      .from(notifications)
      .where(eq(notifications.userId, secondUserId));
    expect(foreign?.readAt).toBeNull();
  });

  it("requires an authenticated session", async () => {
    await expect(
      app.inject({ method: "GET", url: "/me/notifications" }),
    ).resolves.toMatchObject({ statusCode: 401 });
    const cookie = await login(firstEmail);
    await expect(
      app.inject({
        method: "GET",
        url: `/me/notifications?userId=${secondUserId}`,
        headers: { cookie },
      }),
    ).resolves.toMatchObject({ statusCode: 422 });
  });
});
