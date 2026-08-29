import type { FastifyInstance } from "fastify";
import type { NodeProxDatabase } from "../../../../../../database/client.js";
import { AppError } from "../../../errors/app-error.js";
import { getRequestContext } from "../../../plugins/request-context.js";
import type { SessionCookieAdapter } from "../../authentication/infrastructure/http/session-cookie.adapter.js";
import type { SessionService } from "../../authentication/application/services/session.service.js";
import { requireSession } from "../../authentication/presentation/session-guards.js";
import type { AuthorizationService } from "../../authorization/application/services/authorization.service.js";
import { GetOverviewQuery } from "../application/services/get-overview.query.js";
import { DrizzleOverviewReadRepository } from "../infrastructure/persistence/drizzle/drizzle-overview-read.repository.js";

function context() {
  const value = getRequestContext();
  if (!value?.userId || !value.sessionId)
    throw new AppError({
      code: "authentication-required",
      detail: "Authentication is required.",
      statusCode: 401,
      title: "Authentication required",
      type: "https://nodeprox.dev/problems/authentication-required",
    });
  return { userId: value.userId, sessionId: value.sessionId };
}

export function registerOverviewPlugin(
  app: FastifyInstance,
  db: NodeProxDatabase,
  authentication: { service: SessionService; cookies: SessionCookieAdapter },
  authorization: AuthorizationService,
) {
  const query = new GetOverviewQuery(new DrizzleOverviewReadRepository(db));
  const session = requireSession(
    authentication.service,
    authentication.cookies,
  );

  app.get("/overview", { preHandler: session }, async () => {
    const actor = context();
    const projection = await authorization.projectCapabilities(actor);
    return query.execute({ capabilities: projection.capabilities });
  });
}
