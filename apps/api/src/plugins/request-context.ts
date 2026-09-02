import { AsyncLocalStorage } from "node:async_hooks";
import type { OperationAuditContext, RequestContext } from "@nodeprox/types";
import type { FastifyInstance } from "fastify";

const requestContextStorage = new AsyncLocalStorage<RequestContext>();

export function registerRequestContext(app: FastifyInstance): void {
  app.addHook("onRequest", (request, reply, done) => {
    const requestId = request.id;
    const context: RequestContext = { requestId };

    reply.header("x-request-id", requestId);
    requestContextStorage.run(context, done);
  });
}

export function getRequestContext(): RequestContext | undefined {
  return requestContextStorage.getStore();
}

export function runWithRequestContext<T>(
  context: RequestContext,
  operation: () => T | Promise<T>,
): T | Promise<T> {
  return requestContextStorage.run(context, operation);
}

export function updateRequestContext(
  updates: Partial<Omit<RequestContext, "requestId">>,
): void {
  const context = requestContextStorage.getStore();
  if (context) {
    Object.assign(context, updates);
    if (updates.userId) context.actorId = updates.userId;
  }
}

/**
 * Associates an explicitly declared business operation with the current
 * request. The error boundary may use it for rejected/failed audit events.
 */
export function setOperationAuditContext(
  operationAudit: OperationAuditContext,
): void {
  updateRequestContext({ operationAudit, operationAuditRecorded: false });
}

/** Marks an audit event already written by the successful operation. */
export function markOperationAuditRecorded(): void {
  updateRequestContext({ operationAuditRecorded: true });
}
