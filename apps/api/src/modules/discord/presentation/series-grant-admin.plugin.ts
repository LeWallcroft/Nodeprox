import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { AppError } from "../../../errors/app-error.js";
import { getRequestContext } from "../../../plugins/request-context.js";
import type { SessionService } from "../../authentication/application/services/session.service.js";
import type { SessionCookieAdapter } from "../../authentication/infrastructure/http/session-cookie.adapter.js";
import { requireSession } from "../../authentication/presentation/session-guards.js";
import {
  DiscordGrantAdministrationForbiddenError,
  DiscordGrantAdministrationValidationError,
  type ListSeriesCreationGrantsForAdministrationService,
} from "../application/list-series-creation-grants-for-administration.service.js";
import {
  WebGrantForbiddenError,
  WebGrantLifecycleError,
  WebGrantNotFoundError,
  type WebSeriesCreationGrantService,
} from "../application/web-series-creation-grant.service.js";

const querySchema = z
  .object({
    status: z
      .enum(["available", "reserved", "consumed", "invalidated"])
      .optional(),
    targetUserId: z.uuid().optional(),
    search: z.string().trim().min(1).max(100).optional(),
    cursor: z.string().min(1).max(512).optional(),
    limit: z.coerce.number().int().min(1).max(100).default(25),
  })
  .strict();
const issueSchema = z
  .object({
    targetUserId: z.uuid(),
    reference: z.string().trim().max(500).optional(),
  })
  .strict();
const idSchema = z.object({ id: z.uuid() }).strict();
const problem = (code: string, statusCode: number) =>
  new AppError({
    code,
    statusCode,
    title: "Series creation grant error",
    detail: "The grant request could not be completed.",
    type: `https://nodeprox.dev/problems/${code}`,
  });
function parse<T extends z.ZodType>(schema: T, value: unknown): z.infer<T> {
  const result = schema.safeParse(value);
  if (!result.success) throw problem("validation-failed", 422);
  return result.data;
}
function actor() {
  const context = getRequestContext();
  if (!context?.userId || !context.sessionId)
    throw problem("authentication-required", 401);
  return { userId: context.userId, sessionId: context.sessionId };
}
function map(error: unknown): never {
  if (
    error instanceof DiscordGrantAdministrationForbiddenError ||
    error instanceof WebGrantForbiddenError
  )
    throw problem("authorization-denied", 403);
  if (error instanceof DiscordGrantAdministrationValidationError)
    throw problem("validation-failed", 422);
  if (error instanceof WebGrantNotFoundError)
    throw problem("resource-not-found", 404);
  if (error instanceof WebGrantLifecycleError)
    throw problem("series-creation-grant-invalidated", 409);
  throw error;
}

export function registerSeriesGrantAdminPlugin(
  app: FastifyInstance,
  input: {
    list: ListSeriesCreationGrantsForAdministrationService;
    commands: WebSeriesCreationGrantService;
    authentication: { service: SessionService; cookies: SessionCookieAdapter };
  },
) {
  const session = requireSession(
    input.authentication.service,
    input.authentication.cookies,
  );
  app.get(
    "/admin/series-creation-grants",
    { preHandler: session },
    async (request) => {
      try {
        return await input.list.execute(
          actor(),
          parse(querySchema, request.query),
        );
      } catch (error) {
        return map(error);
      }
    },
  );
  app.post(
    "/admin/series-creation-grants",
    { preHandler: session },
    async (request, reply) => {
      try {
        return reply
          .code(201)
          .send(
            await input.commands.issue(
              actor(),
              parse(issueSchema, request.body),
            ),
          );
      } catch (error) {
        return map(error);
      }
    },
  );
  app.post(
    "/admin/series-creation-grants/:id/invalidate",
    { preHandler: session },
    async (request) => {
      try {
        return await input.commands.invalidate(
          actor(),
          parse(idSchema, request.params).id,
        );
      } catch (error) {
        return map(error);
      }
    },
  );
  app.get(
    "/admin/series-creation-grants/:id/history",
    { preHandler: session },
    async (request) => {
      try {
        return {
          items: await input.commands.history(
            actor(),
            parse(idSchema, request.params).id,
          ),
        };
      } catch (error) {
        return map(error);
      }
    },
  );
}
