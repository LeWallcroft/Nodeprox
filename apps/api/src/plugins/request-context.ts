import { AsyncLocalStorage } from "node:async_hooks";
import type { OperationAuditContext, RequestContext } from "@nodeprox/types";
import type { FastifyInstance } from "fastify";
import { eq } from "drizzle-orm";
import type { NodeProxDatabase } from "../../../../database/client.js";
import { auditLogs } from "../../../../database/schema/index.js";

const requestContextStorage = new AsyncLocalStorage<RequestContext>();

export function registerRequestContext(
  app: FastifyInstance,
  database?: NodeProxDatabase,
): void {
  app.addHook("onRequest", (request, reply, done) => {
    const requestId = request.id;
    const context: RequestContext = { requestId, requestStartedAt: Date.now() };

    reply.header("x-request-id", requestId);
    requestContextStorage.run(context, done);
  });
  if (!database) return;
  app.addHook("onResponse", async (request) => {
    const context = getRequestContext();
    const startedAt = context?.requestStartedAt;
    const client = clientDetails(request.headers["user-agent"]);
    try {
      await database
        .update(auditLogs)
        .set({
          ipAddress: request.ip,
          requestMethod: request.method,
          requestPath: request.routeOptions.url ?? normalizedPath(request.url),
          durationMs: startedAt ? Math.max(0, Date.now() - startedAt) : null,
          clientBrowser: client.browser,
          clientOperatingSystem: client.operatingSystem,
        })
        .where(eq(auditLogs.requestId, request.id));
    } catch (error) {
      request.log.warn(
        { err: error, requestId: request.id },
        "Audit request context could not be persisted",
      );
    }
  });
}

function normalizedPath(url: string): string {
  const [path = "/"] = url.split("?", 1);
  return path
    .split("/")
    .map((segment) =>
      /^[0-9a-f]{8}-[0-9a-f-]{27,}$/i.test(segment) ? ":id" : segment,
    )
    .join("/");
}

function clientDetails(userAgent: string | undefined): {
  browser: string | null;
  operatingSystem: string | null;
} {
  if (!userAgent) return { browser: null, operatingSystem: null };
  const edge = /Edg\/([\d.]+)/.exec(userAgent);
  const chrome = /Chrome\/([\d.]+)/.exec(userAgent);
  const firefox = /Firefox\/([\d.]+)/.exec(userAgent);
  const safari = /Version\/([\d.]+).*Safari/.exec(userAgent);
  const browser = edge?.[1]
    ? `Microsoft Edge ${edge[1]}`
    : chrome?.[1]
      ? `Chrome ${chrome[1]}`
      : firefox?.[1]
        ? `Firefox ${firefox[1]}`
        : safari?.[1]
          ? `Safari ${safari[1]}`
          : null;
  const android = /Android ([\d.]+)/.exec(userAgent);
  const ios = /iPhone OS ([\d_]+)/.exec(userAgent);
  const macOs = /Mac OS X ([\d_]+)/.exec(userAgent);
  const operatingSystem = /Windows NT 10\.0/.test(userAgent)
    ? "Windows 10/11"
    : /Windows NT/.test(userAgent)
      ? "Windows"
      : android?.[1]
        ? `Android ${android[1]}`
        : ios?.[1]
          ? `iOS ${ios[1].replaceAll("_", ".")}`
          : macOs?.[1]
            ? `macOS ${macOs[1].replaceAll("_", ".")}`
            : /Linux/.test(userAgent)
              ? "Linux"
              : null;
  return { browser, operatingSystem };
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
