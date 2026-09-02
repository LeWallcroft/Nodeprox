import type { FastifyInstance } from "fastify";
import { z } from "zod";
import type { NodeProxDatabase } from "../../../../../../database/client.js";
import { AppError } from "../../../errors/app-error.js";
import {
  getRequestContext,
  markOperationAuditRecorded,
  setOperationAuditContext,
} from "../../../plugins/request-context.js";
import type { SessionCookieAdapter } from "../../authentication/infrastructure/http/session-cookie.adapter.js";
import type { SessionService } from "../../authentication/application/services/session.service.js";
import { requireSession } from "../../authentication/presentation/session-guards.js";
import type { AuthorizationService } from "../application/services/authorization.service.js";
import {
  ProductSettingsForbiddenError,
  ProductSettingsService,
  ProductSettingsValidationError,
} from "../application/services/product-settings.service.js";
import { DrizzleAuthorizationRepository } from "../infrastructure/persistence/drizzle/authorization.repository.js";

const schema = z
  .object({
    changes: z
      .array(
        z
          .object({
            key: z.string().min(1),
            value: z.union([z.number(), z.boolean(), z.string()]),
          })
          .strict(),
      )
      .min(1),
  })
  .strict();

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

const forbidden = () =>
  new AppError({
    code: "authorization-denied",
    detail: "You are not authorized to manage product settings.",
    statusCode: 403,
    title: "Forbidden",
    type: "https://nodeprox.dev/problems/authorization-denied",
  });
const invalid = () =>
  new AppError({
    code: "validation-failed",
    detail: "The requested setting change is invalid.",
    statusCode: 422,
    title: "Validation failed",
    type: "https://nodeprox.dev/problems/validation-failed",
  });

export function registerSettingsPlugin(
  app: FastifyInstance,
  db: NodeProxDatabase,
  authentication: { service: SessionService; cookies: SessionCookieAdapter },
  authorization: AuthorizationService,
) {
  const repository = new DrizzleAuthorizationRepository(db);
  const settings = new ProductSettingsService(repository, authorization);
  const session = requireSession(
    authentication.service,
    authentication.cookies,
  );

  app.get("/admin/settings", { preHandler: session }, async () => {
    try {
      return await settings.list(context());
    } catch (error) {
      if (error instanceof ProductSettingsForbiddenError) throw forbidden();
      throw error;
    }
  });

  app.patch("/admin/settings", { preHandler: session }, async (request) => {
    const input = schema.safeParse(request.body);
    if (!input.success) throw invalid();
    setOperationAuditContext({
      action: "settings.updated",
      resourceType: "product-settings",
    });
    try {
      const result = await settings.update(
        context(),
        input.data.changes,
        getRequestContext()?.requestId,
      );
      markOperationAuditRecorded();
      return result;
    } catch (error) {
      if (error instanceof ProductSettingsForbiddenError) throw forbidden();
      if (error instanceof ProductSettingsValidationError) throw invalid();
      throw error;
    }
  });
}
