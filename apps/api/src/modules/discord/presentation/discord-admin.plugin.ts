import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { AppError } from "../../../errors/app-error.js";
import { getRequestContext } from "../../../plugins/request-context.js";
import type { SessionService } from "../../authentication/application/services/session.service.js";
import type { SessionCookieAdapter } from "../../authentication/infrastructure/http/session-cookie.adapter.js";
import { requireSession } from "../../authentication/presentation/session-guards.js";
import { discordBotCapabilities } from "../application/discord-authorization-policy.js";
import {
  DiscordRoleConfigurationForbiddenError,
  type DiscordRoleConfigurationService,
  DiscordRoleConfigurationUnavailableError,
  DiscordRoleConfigurationValidationError,
} from "../application/discord-role-configuration.service.js";

const roleSchema = z
  .object({
    roleId: z
      .string()
      .trim()
      .regex(/^\d{17,20}$/),
    capabilities: z.array(z.enum(discordBotCapabilities)).max(3),
  })
  .strict();
const replaceSchema = z
  .object({ roles: z.array(roleSchema).max(100) })
  .strict();

const failure = (code: string, statusCode: number, detail: string) =>
  new AppError({
    code,
    statusCode,
    title: "Discord role configuration error",
    detail,
    type: `https://nodeprox.dev/problems/${code}`,
  });

function actor() {
  const context = getRequestContext();
  if (!context?.userId || !context.sessionId)
    throw failure(
      "authentication-required",
      401,
      "Authentication is required.",
    );
  return { userId: context.userId, sessionId: context.sessionId };
}

function map(error: unknown): never {
  if (error instanceof DiscordRoleConfigurationForbiddenError)
    throw failure(
      "authorization-denied",
      403,
      "You are not authorized to configure Discord integration roles.",
    );
  if (error instanceof DiscordRoleConfigurationUnavailableError)
    throw failure(
      "discord-role-verification-unavailable",
      503,
      "No fue posible validar los roles de Discord.",
    );
  if (error instanceof DiscordRoleConfigurationValidationError)
    throw failure(
      "validation-failed",
      422,
      "The Discord role configuration is invalid.",
    );
  throw error;
}

export function registerDiscordAdminPlugin(
  app: FastifyInstance,
  input: {
    service: DiscordRoleConfigurationService;
    authentication: { service: SessionService; cookies: SessionCookieAdapter };
  },
) {
  const session = requireSession(
    input.authentication.service,
    input.authentication.cookies,
  );
  app.get(
    "/admin/discord/authorized-roles",
    { preHandler: session },
    async () => {
      try {
        return await input.service.listAuthorizedRoles(actor());
      } catch (error) {
        return map(error);
      }
    },
  );
  app.put(
    "/admin/discord/authorized-roles",
    { preHandler: session },
    async (request) => {
      const parsed = replaceSchema.safeParse(request.body);
      if (!parsed.success)
        throw failure(
          "validation-failed",
          422,
          "The Discord role configuration is invalid.",
        );
      try {
        return await input.service.replaceAuthorizedRoles(
          actor(),
          parsed.data.roles,
          getRequestContext()?.requestId,
        );
      } catch (error) {
        return map(error);
      }
    },
  );
}
