import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { getRequestContext } from "../../../plugins/request-context.js";
import type { requireSession } from "../../authentication/presentation/session-guards.js";
import type { ListUploadOperationsService } from "../application/services/list-upload-operations.service.js";

const querySchema = z
  .object({ limit: z.coerce.number().int().min(1).max(100).optional() })
  .strict();

export function registerUploadCenterPlugin(
  app: FastifyInstance,
  dependencies: {
    service: ListUploadOperationsService;
    sessionGuard: ReturnType<typeof requireSession>;
  },
) {
  app.get(
    "/me/upload-operations",
    { preHandler: dependencies.sessionGuard },
    async (request) => {
      const query = querySchema.parse(request.query);
      const context = getRequestContext();
      if (!context?.userId)
        throw new Error("authenticated-user-context-missing");
      const items = await dependencies.service.execute({
        userId: context.userId,
        ...(query.limit ? { limit: query.limit } : {}),
      });
      return {
        items: items.map((item) => ({
          ...item,
          createdAt: item.createdAt.toISOString(),
          updatedAt: item.updatedAt.toISOString(),
          completedAt: item.completedAt?.toISOString() ?? null,
        })),
      };
    },
  );
}
