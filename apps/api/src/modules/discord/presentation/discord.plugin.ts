import type { FastifyInstance, FastifyRequest } from "fastify";
import { z } from "zod";
import { AppError } from "../../../errors/app-error.js";
import { getRequestContext } from "../../../plugins/request-context.js";
import type { SessionService } from "../../authentication/application/services/session.service.js";
import type { SessionCookieAdapter } from "../../authentication/infrastructure/http/session-cookie.adapter.js";
import { requireSession } from "../../authentication/presentation/session-guards.js";
import {
  DiscordGatewayError,
  type DiscordGatewayService,
  matchesInternalToken,
} from "../application/discord-gateway.service.js";
import {
  DiscordGrantAdministrationForbiddenError,
  DiscordGrantAdministrationValidationError,
  type ListSeriesCreationGrantsForAdministrationService,
} from "../application/list-series-creation-grants-for-administration.service.js";

const grantInput = z
  .object({
    targetDiscordId: z.string().trim().min(1).max(32),
    reference: z.string().optional(),
    actorDiscordId: z.string().trim().min(1).max(32),
    actorRoleIds: z.array(z.string().trim().min(1).max(64)).max(100),
    guildId: z.string().trim().min(1).max(32),
    channelId: z.string().trim().min(1).max(32),
    interactionId: z.string().trim().min(1).max(128),
  })
  .strict();
const invalidateInput = grantInput.omit({
  targetDiscordId: true,
  reference: true,
});
const confirmInput = z
  .object({
    code: z.string().trim().min(1).max(64),
    discordId: z.string().trim().min(1).max(32),
    guildId: z.string().trim().min(1).max(32),
    channelId: z.string().trim().min(1).max(32),
    interactionId: z.string().trim().min(1).max(128),
    actorDiscordId: z.string().trim().min(1).max(32),
  })
  .strict();
const botCapability = z.enum([
  "series_grant.issue",
  "series_grant.invalidate",
  "bot.configure",
]);
const replaceAuthorizedRolesInput = z
  .object({
    actorDiscordId: z.string().trim().min(1).max(32),
    actorRoleIds: z.array(z.string().trim().min(1).max(64)).max(100),
    guildId: z.string().trim().min(1).max(32),
    channelId: z.string().trim().min(1).max(32),
    interactionId: z.string().trim().min(1).max(128),
    roles: z
      .array(
        z
          .object({
            roleId: z
              .string()
              .trim()
              .regex(/^\d{17,20}$/),
            capabilities: z.array(botCapability).max(3),
          })
          .strict(),
      )
      .min(1)
      .max(100),
  })
  .strict();
const idSchema = z.object({ id: z.uuid() }).strict();
const statusSchema = z
  .object({
    status: z
      .enum(["available", "reserved", "consumed", "invalidated"])
      .optional(),
  })
  .strict();
const adminGrantQuerySchema = statusSchema.extend({
  targetUserId: z.uuid().optional(),
  cursor: z.string().min(1).max(512).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(25),
});

function problem(code: string, statusCode: number) {
  return new AppError({
    code,
    statusCode,
    title: "Discord integration error",
    detail: "The Discord integration request could not be completed.",
    type: `https://nodeprox.dev/problems/${code}`,
  });
}
function parsed<T extends z.ZodType>(schema: T, value: unknown): z.infer<T> {
  const result = schema.safeParse(value);
  if (!result.success) throw problem("validation-failed", 422);
  return result.data;
}
function mapError(error: unknown): never {
  if (error instanceof DiscordGrantAdministrationForbiddenError)
    throw problem("authorization-denied", 403);
  if (error instanceof DiscordGrantAdministrationValidationError)
    throw problem("validation-failed", 422);
  if (!(error instanceof DiscordGatewayError)) throw error;
  const status =
    error.code === "resource-not-found" ||
    error.code === "series-creation-grant-not-found"
      ? 404
      : error.code === "discord-id-already-linked" ||
          error.code === "discord-interaction-already-processed" ||
          error.code === "series-creation-grant-invalidated"
        ? 409
        : error.code === "discord-not-linked" ||
            error.code === "discord-actor-role-not-authorized"
          ? 403
          : error.code === "discord-link-code-invalid"
            ? 400
            : error.code === "configuration-lockout" ||
                error.code === "configuration-invalid-role"
              ? 422
              : error.code === "discord-role-verification-unavailable"
                ? 503
                : 403;
  throw problem(error.code, status);
}
function internal(expectedToken: string | undefined) {
  return async (request: FastifyRequest) => {
    const header = request.headers.authorization;
    const token = header?.startsWith("Bearer ") ? header.slice(7) : undefined;
    if (!matchesInternalToken(token, expectedToken))
      throw problem("internal-authentication-required", 401);
  };
}
function sessionContext() {
  const context = getRequestContext();
  if (!context?.userId) throw problem("authentication-required", 401);
  return context.userId;
}

function sessionActor() {
  const context = getRequestContext();
  if (!context?.userId || !context.sessionId)
    throw problem("authentication-required", 401);
  return { userId: context.userId, sessionId: context.sessionId };
}

export function registerDiscordPlugin(
  app: FastifyInstance,
  input: {
    service: DiscordGatewayService;
    grantAdministration: ListSeriesCreationGrantsForAdministrationService;
    internalToken?: string | undefined;
    authentication: { service: SessionService; cookies: SessionCookieAdapter };
  },
) {
  const internalGuard = internal(input.internalToken);
  const sessionGuard = requireSession(
    input.authentication.service,
    input.authentication.cookies,
  );
  app.addHook("onReady", async () => input.service.bootstrapIntegration());
  app.post(
    "/internal/discord/series-grants",
    { preHandler: internalGuard },
    async (request, reply) => {
      try {
        return reply
          .code(201)
          .send(
            await input.service.issueGrant(parsed(grantInput, request.body)),
          );
      } catch (error) {
        return mapError(error);
      }
    },
  );
  app.get(
    "/admin/series-creation-grants",
    { preHandler: sessionGuard },
    async (request) => {
      try {
        return await input.grantAdministration.execute(
          sessionActor(),
          parsed(adminGrantQuerySchema, request.query),
        );
      } catch (error) {
        return mapError(error);
      }
    },
  );
  app.post(
    "/internal/discord/series-grants/:id/invalidate",
    { preHandler: internalGuard },
    async (request) => {
      try {
        return await input.service.invalidateGrant({
          grantId: parsed(idSchema, request.params).id,
          ...parsed(invalidateInput, request.body),
        });
      } catch (error) {
        return mapError(error);
      }
    },
  );
  app.get(
    "/internal/discord/integration",
    { preHandler: internalGuard },
    async () => {
      try {
        return await input.service.integration();
      } catch (error) {
        return mapError(error);
      }
    },
  );
  app.get(
    "/internal/discord/configuration",
    { preHandler: internalGuard },
    async () => {
      try {
        return await input.service.configuration();
      } catch (error) {
        return mapError(error);
      }
    },
  );
  app.put(
    "/internal/discord/authorized-roles",
    { preHandler: internalGuard },
    async (request) => {
      try {
        return await input.service.replaceAuthorizedRoles(
          parsed(replaceAuthorizedRolesInput, request.body),
        );
      } catch (error) {
        return mapError(error);
      }
    },
  );
  app.post(
    "/internal/discord/confirm-link",
    { preHandler: internalGuard },
    async (request) => {
      try {
        return await input.service.confirmLink(
          parsed(confirmInput, request.body),
        );
      } catch (error) {
        return mapError(error);
      }
    },
  );
  app.post("/me/discord/link-code", { preHandler: sessionGuard }, async () =>
    input.service.createLinkCode(sessionContext()),
  );
  app.get(
    "/me/series-creation-grants",
    { preHandler: sessionGuard },
    async (request) =>
      input.service.listGrantsForUser(
        sessionContext(),
        parsed(statusSchema, request.query).status,
      ),
  );
}
