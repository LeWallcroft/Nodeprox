import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { AppError } from "../../../errors/app-error.js";
import { getRequestContext } from "../../../plugins/request-context.js";
import type { SessionService } from "../../authentication/application/services/session.service.js";
import type { SessionCookieAdapter } from "../../authentication/infrastructure/http/session-cookie.adapter.js";
import { requireSession } from "../../authentication/presentation/session-guards.js";
import type { NotificationRepository } from "../application/notification.repository.js";
import { NotificationCursorError } from "../infrastructure/persistence/drizzle-notification.repository.js";

const listQuery = z
  .object({
    cursor: z.string().min(1).max(512).optional(),
    limit: z.coerce.number().int().min(1).max(100).default(25),
  })
  .strict();
const idParams = z.object({ id: z.uuid() }).strict();

function problem(code: string, statusCode: number) {
  return new AppError({
    code,
    statusCode,
    title: "Notification request failed",
    detail: "The notification request could not be completed.",
    type: `https://nodeprox.dev/problems/${code}`,
  });
}

function currentUserId(): string {
  const context = getRequestContext();
  if (!context?.userId) throw problem("authentication-required", 401);
  return context.userId;
}

function handleError(error: unknown): never {
  if (error instanceof NotificationCursorError)
    throw problem("validation-failed", 422);
  throw error;
}

export function registerNotificationPlugin(
  app: FastifyInstance,
  input: {
    repository: NotificationRepository;
    authentication: { service: SessionService; cookies: SessionCookieAdapter };
  },
) {
  const sessionGuard = requireSession(
    input.authentication.service,
    input.authentication.cookies,
  );

  app.get(
    "/me/notifications",
    { preHandler: sessionGuard },
    async (request) => {
      try {
        const query = listQuery.safeParse(request.query);
        if (!query.success) throw problem("validation-failed", 422);
        const page = await input.repository.listForUser({
          userId: currentUserId(),
          ...query.data,
        });
        return {
          items: page.items.map((notification) => ({
            id: notification.id,
            type: notification.type,
            title: notification.title,
            message: notification.message,
            entityType: notification.entityType,
            entityId: notification.entityId,
            actionKey: notification.actionKey,
            readAt: notification.readAt?.toISOString() ?? null,
            createdAt: notification.createdAt.toISOString(),
          })),
          nextCursor: page.nextCursor,
        };
      } catch (error) {
        return handleError(error);
      }
    },
  );
  app.get(
    "/me/notifications/unread-count",
    { preHandler: sessionGuard },
    async () => ({
      count: await input.repository.countUnread(currentUserId()),
    }),
  );
  app.patch(
    "/me/notifications/:id/read",
    { preHandler: sessionGuard },
    async (request) => {
      const params = idParams.safeParse(request.params);
      if (!params.success) throw problem("validation-failed", 422);
      const changed = await input.repository.markRead({
        userId: currentUserId(),
        notificationId: params.data.id,
        readAt: new Date(),
      });
      if (!changed) throw problem("resource-not-found", 404);
      return { read: true };
    },
  );
  app.post(
    "/me/notifications/read-all",
    { preHandler: sessionGuard },
    async () => ({
      count: await input.repository.markAllRead({
        userId: currentUserId(),
        readAt: new Date(),
      }),
    }),
  );
}
