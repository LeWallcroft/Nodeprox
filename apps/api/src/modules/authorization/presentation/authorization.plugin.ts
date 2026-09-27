import type { FastifyInstance } from "fastify";
import { AppError } from "../../../errors/app-error.js";
import { getRequestContext } from "../../../plugins/request-context.js";
import type { NodeProxDatabase } from "../../../../../../database/client.js";
import type { Permission } from "../domain/permissions.js";
import type { ResourceContext } from "../domain/authorization.types.js";
import { DefaultAuthorizationPolicy } from "../domain/policies/authorization.policy.js";
import { AuthorizationService } from "../application/services/authorization.service.js";
import { DrizzleAuthorizationRepository } from "../infrastructure/persistence/drizzle/authorization.repository.js";
import type { SessionCookieAdapter } from "../../authentication/infrastructure/http/session-cookie.adapter.js";
import type { SessionService } from "../../authentication/application/services/session.service.js";
import { requireSession } from "../../authentication/presentation/session-guards.js";
import { PinoAuthorizationFailureReporter } from "../../../observability/pino-authorization-failure-reporter.js";

const unauthorized = new AppError({
  code: "authentication-required",
  detail: "Authentication is required.",
  statusCode: 401,
  title: "Authentication required",
  type: "https://nodeprox.dev/problems/authentication-required",
});

const forbidden = new AppError({
  code: "authorization-denied",
  detail: "You are not authorized to perform this operation.",
  statusCode: 403,
  title: "Forbidden",
  type: "https://nodeprox.dev/problems/authorization-denied",
});

export function registerAuthorization(
  app: FastifyInstance,
  db: NodeProxDatabase,
  authentication: { service: SessionService; cookies: SessionCookieAdapter },
): AuthorizationService {
  const repository = new DrizzleAuthorizationRepository(db);
  const service = new AuthorizationService(
    new DefaultAuthorizationPolicy(),
    repository,
    repository,
    repository,
    undefined,
    new PinoAuthorizationFailureReporter(app.log),
  );

  app.get(
    "/auth/capabilities",
    {
      preHandler: requireSession(
        authentication.service,
        authentication.cookies,
      ),
    },
    async () => {
      const context = getRequestContext();
      if (!context?.userId || !context.sessionId) throw unauthorized;
      return service.projectCapabilities({
        userId: context.userId,
        sessionId: context.sessionId,
      });
    },
  );

  return service;
}

export function requirePermission(
  service: AuthorizationService,
  permission: Permission,
  resource?: ResourceContext,
) {
  return async () => {
    const context = getRequestContext();
    if (!context?.userId || !context.sessionId) throw unauthorized;
    const decision = await service.authorize(
      { userId: context.userId, sessionId: context.sessionId },
      permission,
      resource,
    );
    if (!decision.allowed) throw forbidden;
  };
}
