import type { FastifyInstance, FastifyRequest } from "fastify";
import { z } from "zod";
import { AppError } from "../../../errors/app-error.js";
import { matchesInternalToken } from "../application/discord-gateway.service.js";
import type { SyncDiscordUserProfilesService } from "../application/sync-discord-user-profiles.service.js";

const paramsSchema = z
  .object({ discordId: z.string().regex(/^\d{17,20}$/) })
  .strict();
const emptyBodySchema = z.object({}).strict();

function failure(code: string, statusCode: number): AppError {
  return new AppError({
    code,
    statusCode,
    title: "Discord profile signal rejected",
    detail: "The Discord profile signal could not be accepted.",
    type: `https://nodeprox.dev/problems/${code}`,
  });
}

export function registerDiscordProfileEventPlugin(
  app: FastifyInstance,
  input: {
    service: SyncDiscordUserProfilesService;
    internalToken?: string | undefined;
  },
): void {
  const internal = async (request: FastifyRequest) => {
    const header = request.headers.authorization;
    const token = header?.startsWith("Bearer ") ? header.slice(7) : undefined;
    if (!matchesInternalToken(token, input.internalToken))
      throw failure("internal-authentication-required", 401);
  };
  app.post(
    "/internal/discord/users/:discordId/profile-changed",
    { preHandler: internal },
    async (request) => {
      const params = paramsSchema.safeParse(request.params);
      const body = emptyBodySchema.safeParse(request.body);
      if (!params.success || !body.success)
        throw failure("validation-failed", 422);
      const result = await input.service.syncLinkedProfileByDiscordId(
        params.data.discordId,
      );
      request.log.info(
        { discordId: params.data.discordId },
        `discord-profile-sync.targeted.${result}`,
      );
      return { accepted: true };
    },
  );
}
