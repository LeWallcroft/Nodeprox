import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { z } from "zod";
import { AppError } from "../../../errors/app-error.js";
import { getRequestContext } from "../../../plugins/request-context.js";
import type { NodeProxDatabase } from "../../../../../../database/client.js";
import type { AuthorizationService } from "../../authorization/application/services/authorization.service.js";
import type { SessionCookieAdapter } from "../../authentication/infrastructure/http/session-cookie.adapter.js";
import type { SessionService } from "../../authentication/application/services/session.service.js";
import { requireSession } from "../../authentication/presentation/session-guards.js";
import {
  ChapterPermissionService,
  InvalidChapterPermissionError,
} from "../application/services/chapter-permission.service.js";
import { DrizzleChapterRepository } from "../infrastructure/persistence/drizzle/chapter.repository.js";
import type { Permission } from "../../authorization/domain/permissions.js";
import { PinoAuthorizationFailureReporter } from "../../../observability/pino-authorization-failure-reporter.js";

const paramsSchema = z.object({ chapterId: z.uuid() }).strict();
const grantBodySchema = z
  .object({
    userId: z.uuid(),
    permissions: z.array(z.string()).min(1),
  })
  .strict();
const revokeParamsSchema = z
  .object({ chapterId: z.uuid(), userId: z.uuid() })
  .strict();

const problem = (input: {
  code: string;
  detail: string;
  statusCode: number;
  title: string;
  type: string;
}) => new AppError(input);

const authenticationRequired = problem({
  code: "authentication-required",
  detail: "Authentication is required.",
  statusCode: 401,
  title: "Authentication required",
  type: "https://nodeprox.dev/problems/authentication-required",
});
const forbidden = problem({
  code: "authorization-denied",
  detail: "You are not authorized to perform this operation.",
  statusCode: 403,
  title: "Forbidden",
  type: "https://nodeprox.dev/problems/authorization-denied",
});
const notFound = problem({
  code: "chapter-not-found",
  detail: "The requested chapter was not found.",
  statusCode: 404,
  title: "Chapter not found",
  type: "https://nodeprox.dev/problems/chapter-not-found",
});
const conflict = problem({
  code: "chapter-permission-conflict",
  detail: "The chapter permission cannot be granted in the current state.",
  statusCode: 409,
  title: "Chapter permission conflict",
  type: "https://nodeprox.dev/problems/chapter-permission-conflict",
});
const invalidPermission = problem({
  code: "chapter-permission-invalid",
  detail: "The requested chapter permission is invalid or not delegable.",
  statusCode: 422,
  title: "Invalid chapter permission",
  type: "https://nodeprox.dev/problems/chapter-permission-invalid",
});

function parseChapterSchema<TSchema extends z.ZodType>(
  schema: TSchema,
  input: unknown,
): z.infer<TSchema> {
  const result = schema.safeParse(input);
  if (!result.success) throw invalidPermission;
  return result.data;
}

function requestContext() {
  const context = getRequestContext();
  if (!context?.userId || !context.sessionId) throw authenticationRequired;
  return { userId: context.userId, sessionId: context.sessionId };
}

function parseParams(request: FastifyRequest) {
  return parseChapterSchema(paramsSchema, request.params);
}

export function requireChapterPermission(
  service: ChapterPermissionService,
  permission: Permission,
) {
  return async (request: FastifyRequest, _reply: FastifyReply) => {
    const context = requestContext();
    const { chapterId } = parseParams(request);
    const decision = await service.check({ context, chapterId, permission });
    if (decision.reason === "not-found") throw notFound;
    if (!decision.allowed) throw forbidden;
  };
}

export function registerChapterPermissionPlugin(
  app: FastifyInstance,
  db: NodeProxDatabase,
  authentication: { service: SessionService; cookies: SessionCookieAdapter },
  authorization: AuthorizationService,
): ChapterPermissionService {
  const repository = new DrizzleChapterRepository(db);
  const service = new ChapterPermissionService(
    authorization,
    repository,
    repository,
    repository,
    repository,
    new PinoAuthorizationFailureReporter(app.log),
  );
  const session = requireSession(
    authentication.service,
    authentication.cookies,
  );

  app.post(
    "/chapters/:chapterId/permissions",
    { preHandler: session },
    async (request, reply) => {
      const { chapterId } = parseParams(request);
      const body = parseChapterSchema(grantBodySchema, request.body);
      const context = requestContext();
      const requestId = getRequestContext()?.requestId;
      try {
        const result = await service.grant({
          context,
          chapterId,
          helperUserId: body.userId,
          permissions: body.permissions,
          ...(requestId ? { requestId } : {}),
        });
        if ("notFound" in result) throw notFound;
        if ("denied" in result) throw forbidden;
        if ("conflict" in result) throw conflict;
        return reply.code(204).send();
      } catch (error) {
        if (error instanceof InvalidChapterPermissionError)
          throw invalidPermission;
        throw error;
      }
    },
  );

  app.get(
    "/chapters/:chapterId/permissions",
    { preHandler: session },
    async (request) => {
      const { chapterId } = parseParams(request);
      const result = await service.list(requestContext(), chapterId);
      if ("notFound" in result) throw notFound;
      if ("denied" in result) throw forbidden;
      return result.helpers;
    },
  );

  app.get(
    "/chapters/:chapterId/helper-candidates",
    { preHandler: session },
    async (request) => {
      const { chapterId } = parseParams(request);
      const result = await service.listCandidates(requestContext(), chapterId);
      if ("notFound" in result) throw notFound;
      if ("denied" in result) throw forbidden;
      return result.candidates;
    },
  );

  app.delete(
    "/chapters/:chapterId/permissions/:userId",
    { preHandler: session },
    async (request, reply) => {
      const params = parseChapterSchema(revokeParamsSchema, request.params);
      const result = await service.revoke({
        context: requestContext(),
        chapterId: params.chapterId,
        helperUserId: params.userId,
      });
      if ("notFound" in result) throw notFound;
      if ("denied" in result) throw forbidden;
      return reply.code(204).send();
    },
  );

  return service;
}
