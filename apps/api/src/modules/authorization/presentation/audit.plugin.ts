import { desc, eq } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import type { NodeProxDatabase } from "../../../../../../database/client.js";
import { auditLogs, users } from "../../../../../../database/schema/index.js";
import type { SessionCookieAdapter } from "../../authentication/infrastructure/http/session-cookie.adapter.js";
import type { SessionService } from "../../authentication/application/services/session.service.js";
import { requireSession } from "../../authentication/presentation/session-guards.js";
import { getRequestContext } from "../../../plugins/request-context.js";
import type { AuthorizationService } from "../application/services/authorization.service.js";
import { PERMISSIONS } from "../domain/permissions.js";
import { AppError } from "../../../errors/app-error.js";

export function registerAuditPlugin(
  app: FastifyInstance,
  db: NodeProxDatabase,
  authentication: { service: SessionService; cookies: SessionCookieAdapter },
  authorization: AuthorizationService,
) {
  app.get(
    "/admin/audit",
    {
      preHandler: requireSession(
        authentication.service,
        authentication.cookies,
      ),
    },
    async () => {
      const context = getRequestContext();
      if (!context?.userId || !context.sessionId)
        throw new AppError({
          code: "authentication-required",
          detail: "Authentication is required.",
          statusCode: 401,
          title: "Authentication required",
          type: "https://nodeprox.dev/problems/authentication-required",
        });
      const allowed = await authorization.authorize(
        { userId: context.userId, sessionId: context.sessionId },
        PERMISSIONS.ADMIN_SYSTEM_MANAGE,
      );
      if (!allowed.allowed)
        throw new AppError({
          code: "authorization-denied",
          detail: "You are not authorized to view audit events.",
          statusCode: 403,
          title: "Forbidden",
          type: "https://nodeprox.dev/problems/authorization-denied",
        });
      return db
        .select({
          id: auditLogs.id,
          actorId: auditLogs.actorId,
          actorEmail: users.email,
          action: auditLogs.action,
          resourceType: auditLogs.resourceType,
          resourceId: auditLogs.resourceId,
          result: auditLogs.result,
          reasonCode: auditLogs.reasonCode,
          requestId: auditLogs.requestId,
          metadata: auditLogs.metadata,
          createdAt: auditLogs.createdAt,
        })
        .from(auditLogs)
        .leftJoin(users, eq(users.id, auditLogs.actorId))
        .orderBy(desc(auditLogs.createdAt))
        .limit(200);
    },
  );
}
