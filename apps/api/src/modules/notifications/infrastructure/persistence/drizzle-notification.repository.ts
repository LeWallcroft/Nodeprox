import { and, desc, eq, isNull, lt, or } from "drizzle-orm";
import type { NodeProxDatabase } from "../../../../../../../database/client.js";
import { notifications } from "../../../../../../../database/schema/index.js";
import type {
  NotificationPage,
  NotificationRecord,
  NotificationRepository,
} from "../../application/notification.repository.js";

type Cursor = { createdAt: string; id: string };

export class DrizzleNotificationRepository implements NotificationRepository {
  constructor(private readonly db: NodeProxDatabase) {}

  async createIfAbsent(
    input: Omit<NotificationRecord, "id" | "readAt" | "createdAt">,
  ) {
    const [created] = await this.db
      .insert(notifications)
      .values(input)
      .onConflictDoNothing({
        target: [notifications.userId, notifications.sourceEventId],
      })
      .returning();
    if (created) return { created: true, notification: created };

    const [existing] = await this.db
      .select()
      .from(notifications)
      .where(
        and(
          eq(notifications.userId, input.userId),
          eq(notifications.sourceEventId, input.sourceEventId),
        ),
      );
    if (!existing) throw new Error("notification-idempotency-read-failed");
    return { created: false, notification: existing };
  }

  async listForUser(input: {
    userId: string;
    cursor?: string | undefined;
    limit: number;
  }): Promise<NotificationPage> {
    const cursor = input.cursor ? decodeCursor(input.cursor) : undefined;
    const rows = await this.db
      .select()
      .from(notifications)
      .where(
        and(
          eq(notifications.userId, input.userId),
          ...(cursor
            ? [
                or(
                  lt(notifications.createdAt, new Date(cursor.createdAt)),
                  and(
                    eq(notifications.createdAt, new Date(cursor.createdAt)),
                    lt(notifications.id, cursor.id),
                  ),
                ),
              ]
            : []),
        ),
      )
      .orderBy(desc(notifications.createdAt), desc(notifications.id))
      .limit(input.limit + 1);
    const page = rows.slice(0, input.limit);
    const last = page.at(-1);
    return {
      items: page,
      nextCursor:
        rows.length > input.limit && last
          ? encodeCursor({
              createdAt: last.createdAt.toISOString(),
              id: last.id,
            })
          : null,
    };
  }

  async countUnread(userId: string): Promise<number> {
    const rows = await this.db
      .select({ id: notifications.id })
      .from(notifications)
      .where(
        and(eq(notifications.userId, userId), isNull(notifications.readAt)),
      );
    return rows.length;
  }

  async markRead(input: {
    userId: string;
    notificationId: string;
    readAt: Date;
  }): Promise<boolean> {
    const updated = await this.db
      .update(notifications)
      .set({ readAt: input.readAt })
      .where(
        and(
          eq(notifications.id, input.notificationId),
          eq(notifications.userId, input.userId),
          isNull(notifications.readAt),
        ),
      )
      .returning({ id: notifications.id });
    if (updated.length > 0) return true;
    const [owned] = await this.db
      .select({ id: notifications.id })
      .from(notifications)
      .where(
        and(
          eq(notifications.id, input.notificationId),
          eq(notifications.userId, input.userId),
        ),
      );
    return Boolean(owned);
  }

  async markAllRead(input: { userId: string; readAt: Date }): Promise<number> {
    const updated = await this.db
      .update(notifications)
      .set({ readAt: input.readAt })
      .where(
        and(
          eq(notifications.userId, input.userId),
          isNull(notifications.readAt),
        ),
      )
      .returning({ id: notifications.id });
    return updated.length;
  }
}

function encodeCursor(cursor: Cursor): string {
  return Buffer.from(JSON.stringify(cursor)).toString("base64url");
}

function decodeCursor(value: string): Cursor {
  try {
    const cursor = JSON.parse(Buffer.from(value, "base64url").toString("utf8"));
    if (
      typeof cursor?.createdAt !== "string" ||
      Number.isNaN(new Date(cursor.createdAt).getTime()) ||
      typeof cursor?.id !== "string"
    )
      throw new Error("invalid cursor");
    return { createdAt: cursor.createdAt, id: cursor.id };
  } catch {
    throw new NotificationCursorError();
  }
}

export class NotificationCursorError extends Error {}
