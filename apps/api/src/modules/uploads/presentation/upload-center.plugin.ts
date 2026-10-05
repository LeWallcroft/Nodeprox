import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { getRequestContext } from "../../../plugins/request-context.js";
import { AppError } from "../../../errors/app-error.js";
import type { requireSession } from "../../authentication/presentation/session-guards.js";
import type { ListUploadOperationsService } from "../application/services/list-upload-operations.service.js";
import {
  RetryUploadOperationConflictError,
  RetryUploadOperationDeniedError,
  RetryUploadOperationNotFoundError,
  RetryUploadSourceMissingError,
  type RetryUploadOperationService,
} from "../application/services/retry-upload-operation.service.js";

const querySchema = z
  .object({ limit: z.coerce.number().int().min(1).max(100).optional() })
  .strict();
const operationParamsSchema = z
  .object({
    kind: z.enum(["chapter_import", "chapter_upload", "chapter_replacement"]),
    operationId: z.uuid(),
  })
  .strict();

export function registerUploadCenterPlugin(
  app: FastifyInstance,
  dependencies: {
    service: ListUploadOperationsService;
    operations: RetryUploadOperationService;
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
  app.get(
    "/me/upload-operations/:kind/:operationId/validation-report",
    { preHandler: dependencies.sessionGuard },
    async (request) => {
      const { kind, operationId } = operationParamsSchema.parse(request.params);
      const value = getRequestContext();
      if (!value?.userId || !value.sessionId)
        throw problem("authentication-required", 401);
      try {
        const report = await dependencies.operations.report({
          context: { userId: value.userId, sessionId: value.sessionId },
          kind,
          operationId,
        });
        if (!report) throw new RetryUploadOperationNotFoundError();
        return report;
      } catch (error) {
        mapOperationError(error);
      }
    },
  );
  app.post(
    "/me/upload-operations/:kind/:operationId/retry",
    { preHandler: dependencies.sessionGuard },
    async (request) => {
      const { kind, operationId } = operationParamsSchema.parse(request.params);
      const value = getRequestContext();
      if (!value?.userId || !value.sessionId)
        throw problem("authentication-required", 401);
      try {
        return await dependencies.operations.retryUploadOperation({
          context: { userId: value.userId, sessionId: value.sessionId },
          kind,
          operationId,
          ...(value.requestId ? { requestId: value.requestId } : {}),
        });
      } catch (error) {
        mapOperationError(error);
      }
    },
  );
}

function problem(code: string, statusCode: number) {
  return new AppError({
    code,
    statusCode,
    title: code,
    detail: code,
    type: `https://nodeprox.dev/problems/${code}`,
  });
}

function mapOperationError(error: unknown): never {
  if (error instanceof RetryUploadOperationNotFoundError)
    throw problem("upload-operation-not-found", 404);
  if (error instanceof RetryUploadOperationDeniedError)
    throw problem("authorization-denied", 403);
  if (error instanceof RetryUploadOperationConflictError)
    throw problem("upload-operation-conflict", 409);
  if (error instanceof RetryUploadSourceMissingError)
    throw problem("upload-source-missing", 409);
  throw error;
}
