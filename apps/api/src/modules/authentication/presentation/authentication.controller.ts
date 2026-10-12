import type { FastifyInstance } from "fastify";
import { AppError } from "../../../errors/app-error.js";
import { parseWithSchema } from "../../../http/validation.js";
import { loginSchema } from "../application/dto/login.dto.js";
import { AuthenticationRejectedError } from "../application/errors/authentication.errors.js";
import type { SessionCookieAdapter } from "../infrastructure/http/session-cookie.adapter.js";
import type { SessionService } from "../application/services/session.service.js";
import { getResolvedSession, requireSession } from "./session-guards.js";
import { validateMutationOrigin } from "./origin-policy.js";

export function registerAuthenticationController(
  app: FastifyInstance,
  service: SessionService,
  cookies: SessionCookieAdapter,
): void {
  app.post("/auth/login", async (request, reply) => {
    validateMutationOrigin(request);
    const input = parseWithSchema(loginSchema, request.body);
    let result;
    try {
      result = await service.authenticate(input);
    } catch (error) {
      if (error instanceof AuthenticationRejectedError) {
        const pending = error.code === "account-pending";
        throw new AppError({
          code: error.code,
          detail: pending
            ? "The account is pending administrative approval."
            : "Invalid credentials.",
          statusCode: pending ? 403 : 401,
          title: pending ? "Account pending" : "Authentication failed",
          type: `https://nodeprox.dev/problems/${error.code}`,
        });
      }
      throw error;
    }
    cookies.set(reply, result.token);
    return reply.status(204).send();
  });

  app.post("/auth/logout", async (request, reply) => {
    validateMutationOrigin(request);
    const token = cookies.read(request);
    if (token) await service.revoke(token);
    cookies.clear(reply);
    return reply.status(204).send();
  });

  app.get(
    "/auth/session",
    { preHandler: requireSession(service, cookies) },
    async (request, reply) => {
      const result = getResolvedSession(request);
      if (!result)
        throw new AppError({
          code: "authentication-required",
          detail: "Authentication is required.",
          statusCode: 401,
          title: "Authentication required",
          type: "https://nodeprox.dev/problems/authentication-required",
        });
      if (result.rotatedToken) cookies.set(reply, result.rotatedToken);
      return {
        user: result.user,
        session: { id: result.principal.sessionId },
      };
    },
  );
}
