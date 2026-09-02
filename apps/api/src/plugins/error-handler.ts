import type { ProblemDetails } from "@nodeprox/types";
import type { FastifyInstance } from "fastify";
import { AppError } from "../errors/app-error.js";
import { problemCategoryForStatus } from "../errors/error-codes.js";
import { sanitizeOperationalText } from "../observability/sanitize-operational-text.js";
import type { OperationAuditWriter } from "../observability/operation-audit-writer.js";
import { getRequestContext } from "./request-context.js";

const internalError: ProblemDetails = {
  type: "https://nodeprox.dev/problems/internal-error",
  title: "Internal server error",
  status: 500,
  detail: "An unexpected error occurred.",
  code: "internal-error",
  category: "internal",
};

function auditResultFor(
  error: unknown,
):
  | { result: "rejected"; reasonCode: string }
  | { result: "failed"; reasonCode: string }
  | undefined {
  if (!(error instanceof AppError))
    return { result: "failed", reasonCode: "internal-error" };
  if (
    error.category === "authorization" ||
    error.category === "conflict" ||
    error.category === "business_rule" ||
    error.category === "rate_limit"
  )
    return { result: "rejected", reasonCode: error.code };
  if (error.category === "internal" || error.category === "external_dependency")
    return { result: "failed", reasonCode: error.code };
  return undefined;
}

export function registerErrorHandler(
  app: FastifyInstance,
  operationAuditWriter?: OperationAuditWriter,
): void {
  app.setErrorHandler(async (error, request, reply) => {
    const context = getRequestContext();
    const requestId = context?.requestId ?? request.id;

    reply.header("x-request-id", requestId);

    const audit = auditResultFor(error);
    if (
      audit &&
      operationAuditWriter &&
      context?.operationAudit &&
      !context.operationAuditRecorded
    ) {
      try {
        await operationAuditWriter.append({
          ...((context.actorId ?? context.userId)
            ? { actorId: context.actorId ?? context.userId }
            : {}),
          requestId,
          operation: context.operationAudit,
          ...audit,
        });
        context.operationAuditRecorded = true;
      } catch (auditError) {
        request.log.error(
          {
            requestId,
            code: "operation-audit-write-failed",
            errorName:
              auditError instanceof Error ? auditError.name : "UnknownError",
            errorMessage: sanitizeOperationalText(
              auditError instanceof Error
                ? auditError.message
                : "Unknown error",
            ),
          },
          "Operation audit event could not be persisted",
        );
      }
    }

    if (error instanceof AppError) {
      const logContext = {
        requestId,
        actorId: context?.actorId ?? context?.userId,
        code: error.code,
        category: error.category,
        errorName: error.name,
        errorMessage: sanitizeOperationalText(error.message),
      };
      if (
        error.category === "internal" ||
        error.category === "external_dependency"
      )
        request.log.error(
          logContext,
          "Request failed with an application error",
        );
      else if (
        error.category === "authorization" ||
        error.category === "rate_limit"
      )
        request.log.warn(logContext, "Request rejected by application policy");
      else
        request.log.info(logContext, "Request rejected by application policy");
      return reply
        .status(error.statusCode)
        .type("application/problem+json")
        .send(error.toProblemDetails(request.url, requestId));
    }

    request.log.error(
      {
        requestId,
        actorId: context?.actorId ?? context?.userId,
        code: "internal-error",
        errorName: error instanceof Error ? error.name : "UnknownError",
        errorMessage: sanitizeOperationalText(
          error instanceof Error ? error.message : "Unknown error",
        ),
      },
      "Unhandled request error",
    );
    return reply
      .status(500)
      .type("application/problem+json")
      .send({
        ...internalError,
        category: problemCategoryForStatus(500),
        instance: request.url,
        requestId,
      });
  });
}
