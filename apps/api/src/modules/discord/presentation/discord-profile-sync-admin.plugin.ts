import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { AppError } from "../../../errors/app-error.js";
import { getRequestContext } from "../../../plugins/request-context.js";
import type { SessionService } from "../../authentication/application/services/session.service.js";
import type { SessionCookieAdapter } from "../../authentication/infrastructure/http/session-cookie.adapter.js";
import { requireSession } from "../../authentication/presentation/session-guards.js";
import {
  DiscordProfileSyncAdministrationForbiddenError,
  type DiscordProfileSyncAdministrationService,
} from "../application/discord-profile-sync-administration.service.js";

const emptyBodySchema = z.object({}).strict();

function failure(code: string, statusCode: number, detail: string): AppError {
  return new AppError({
    code,
    statusCode,
    title: statusCode === 403 ? "Forbidden" : "Discord profile sync failed",
    detail,
    type: `https://nodeprox.dev/problems/${code}`,
  });
}

function context() {
  const request = getRequestContext();
  if (!request?.userId || !request.sessionId)
    throw failure(
      "authentication-required",
      401,
      "Authentication is required.",
    );
  return {
    actor: { userId: request.userId, sessionId: request.sessionId },
    requestId: request.requestId,
  };
}

function map(error: unknown): never {
  if (error instanceof DiscordProfileSyncAdministrationForbiddenError)
    throw failure(
      "authorization-denied",
      403,
      "You are not authorized to configure the Discord integration.",
    );
  throw error;
}

export function registerDiscordProfileSyncAdminPlugin(
  app: FastifyInstance,
  input: {
    service: DiscordProfileSyncAdministrationService;
    authentication: { service: SessionService; cookies: SessionCookieAdapter };
  },
): void {
  const session = requireSession(
    input.authentication.service,
    input.authentication.cookies,
  );
  app.get("/admin/discord/profile-sync", { preHandler: session }, async () => {
    try {
      const request = context();
      return await input.service.getStatus(request.actor);
    } catch (error) {
      return map(error);
    }
  });
  app.post(
    "/admin/discord/profile-sync",
    { preHandler: session },
    async (request, reply) => {
      const parsed = emptyBodySchema.safeParse(request.body ?? {});
      if (!parsed.success)
        throw failure(
          "validation-failed",
          422,
          "The synchronization request must not include profile data.",
        );
      try {
        const requestContext = context();
        const result = await input.service.triggerSync(
          requestContext.actor,
          requestContext.requestId,
        );
        reply.code(202);
        return result;
      } catch (error) {
        return map(error);
      }
    },
  );
}
