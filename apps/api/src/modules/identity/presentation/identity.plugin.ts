import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { AppError } from "../../../errors/app-error.js";
import { getRequestContext } from "../../../plugins/request-context.js";
import type { NodeProxDatabase } from "../../../../../../database/client.js";
import { Argon2PasswordHasher } from "../../authentication/infrastructure/crypto/argon2-password-hasher.js";
import type { SessionCookieAdapter } from "../../authentication/infrastructure/http/session-cookie.adapter.js";
import type { SessionService } from "../../authentication/application/services/session.service.js";
import { requireSession } from "../../authentication/presentation/session-guards.js";
import { validateMutationOrigin } from "../../authentication/presentation/origin-policy.js";
import type { AuthorizationService } from "../../authorization/application/services/authorization.service.js";
import { UserRepository } from "../../authentication/infrastructure/persistence/drizzle/user.repository.js";
import {
  IdentityService,
  IdentityStateConflictError,
} from "../application/services/identity.service.js";

const registrationSchema = z
  .object({
    email: z.string().trim().email().max(320),
    password: z.string().min(8),
  })
  .strict();
const reviewSchema = z
  .object({
    status: z.enum(["active", "rejected", "suspended"]),
    role: z.enum(["admin", "gestor", "uploader"]).optional(),
  })
  .strict();
const userIdSchema = z.object({ userId: z.uuid() }).strict();

function problem(
  code: string,
  detail: string,
  statusCode: number,
  title: string,
) {
  return new AppError({
    code,
    detail,
    statusCode,
    title,
    type: `https://nodeprox.dev/problems/${code}`,
  });
}

const invalid = () =>
  problem(
    "validation-failed",
    "The request payload is invalid.",
    422,
    "Validation failed",
  );
const notFound = () =>
  problem(
    "resource-not-found",
    "The requested user was not found.",
    404,
    "Resource not found",
  );
const conflict = () =>
  problem(
    "resource-conflict",
    "The requested operation conflicts with the current state.",
    409,
    "Conflict",
  );

function parse<T extends z.ZodType>(schema: T, value: unknown): z.infer<T> {
  const result = schema.safeParse(value);
  if (!result.success) throw invalid();
  return result.data;
}

function context() {
  const value = getRequestContext();
  if (!value?.userId || !value.sessionId)
    throw problem(
      "authentication-required",
      "Authentication is required.",
      401,
      "Authentication required",
    );
  return { userId: value.userId, sessionId: value.sessionId };
}

function isUnique(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  if ("code" in error && error.code === "23505") return true;
  return "cause" in error && isUnique(error.cause);
}

export function registerIdentityPlugin(
  app: FastifyInstance,
  db: NodeProxDatabase,
  authentication: { service: SessionService; cookies: SessionCookieAdapter },
  authorization: AuthorizationService,
): IdentityService {
  const service = new IdentityService(
    new UserRepository(db),
    new Argon2PasswordHasher(),
    authorization,
  );

  app.post("/auth/register", async (request, reply) => {
    validateMutationOrigin(request);
    try {
      return reply
        .code(201)
        .send(await service.register(parse(registrationSchema, request.body)));
    } catch (error) {
      if (isUnique(error)) throw conflict();
      throw error;
    }
  });

  const session = requireSession(
    authentication.service,
    authentication.cookies,
  );
  app.get("/admin/users", { preHandler: session }, async () =>
    service.list(context()),
  );

  app.patch(
    "/admin/users/:userId",
    { preHandler: session },
    async (request) => {
      const { userId } = parse(userIdSchema, request.params);
      try {
        const result = await service.review(
          context(),
          userId,
          parse(reviewSchema, request.body),
        );
        if (!result) throw notFound();
        return result;
      } catch (error) {
        if (error instanceof IdentityStateConflictError) throw conflict();
        throw error;
      }
    },
  );

  return service;
}
