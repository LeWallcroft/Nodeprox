import { and, count, desc, eq, gte, ilike, lte, lt, or } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import type { NodeProxDatabase } from "../../../../../../database/client.js";
import {
  auditLogs,
  chapters,
  series,
  users,
} from "../../../../../../database/schema/index.js";
import type { SessionCookieAdapter } from "../../authentication/infrastructure/http/session-cookie.adapter.js";
import type { SessionService } from "../../authentication/application/services/session.service.js";
import { requireSession } from "../../authentication/presentation/session-guards.js";
import { AppError } from "../../../errors/app-error.js";
import { getRequestContext } from "../../../plugins/request-context.js";
import type { AuthorizationService } from "../application/services/authorization.service.js";
import { PERMISSIONS } from "../domain/permissions.js";

const querySchema = z.object({
  cursor: z.string().min(1).max(512).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(10),
  from: z.coerce.date().optional(),
  to: z.coerce.date().optional(),
  action: z.string().trim().min(1).max(120).optional(),
  actorId: z.uuid().optional(),
  resourceType: z.string().trim().min(1).max(80).optional(),
  result: z.enum(["success", "rejected", "failed"]).optional(),
  search: z.string().trim().min(2).max(120).optional(),
});

type AuditQuery = z.infer<typeof querySchema>;
type Cursor = { createdAt: string; id: string; query: string };

export function registerAuditPlugin(
  app: FastifyInstance,
  db: NodeProxDatabase,
  authentication: { service: SessionService; cookies: SessionCookieAdapter },
  authorization: AuthorizationService,
) {
  const session = requireSession(
    authentication.service,
    authentication.cookies,
  );
  app.get("/admin/audit", { preHandler: session }, async (request) => {
    await requireAuditRead(authorization);
    return listAudit(db, parseQuery(request.query));
  });
  app.get(
    "/admin/audit/export",
    { preHandler: session },
    async (request, reply) => {
      await requireAuditRead(authorization);
      const page = await listAudit(db, {
        ...parseQuery(request.query),
        cursor: undefined,
        limit: 100,
      });
      const csv = [
        "fecha,usuario,rol,accion,recurso,recurso_id,resultado,ip,request_id,motivo",
        ...page.items.map((item) =>
          [
            item.createdAt,
            item.actor.email ?? "",
            item.actor.role ?? "",
            item.action,
            item.resource.type,
            item.resource.id ?? "",
            item.result ?? "",
            item.ipAddress ?? "",
            item.requestId ?? "",
            item.reasonCode ?? "",
          ]
            .map(csvCell)
            .join(","),
        ),
      ].join("\n");
      reply.header("content-type", "text/csv; charset=utf-8");
      reply.header(
        "content-disposition",
        'attachment; filename="nodeprox-auditoria.csv"',
      );
      return csv;
    },
  );
}

async function requireAuditRead(authorization: AuthorizationService) {
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
}

async function listAudit(db: NodeProxDatabase, input: AuditQuery) {
  const signature = querySignature(input);
  const cursor = input.cursor ? decodeCursor(input.cursor) : undefined;
  if (cursor && cursor.query !== signature) throw invalidQuery();
  const search = input.search
    ? `%${input.search.replaceAll("%", "\\%").replaceAll("_", "\\_")}%`
    : undefined;
  const filters = and(
    ...(input.from ? [gte(auditLogs.createdAt, input.from)] : []),
    ...(input.to ? [lte(auditLogs.createdAt, input.to)] : []),
    ...(input.action ? [eq(auditLogs.action, input.action)] : []),
    ...(input.actorId ? [eq(auditLogs.actorId, input.actorId)] : []),
    ...(input.resourceType
      ? [eq(auditLogs.resourceType, input.resourceType)]
      : []),
    ...(input.result ? [eq(auditLogs.result, input.result)] : []),
    ...(search
      ? [
          or(
            ilike(users.email, search),
            ilike(auditLogs.action, search),
            ilike(auditLogs.resourceType, search),
            ilike(auditLogs.reasonCode, search),
          ),
        ]
      : []),
  );
  const [rows, counted] = await Promise.all([
    db
      .select({
        id: auditLogs.id,
        actorId: auditLogs.actorId,
        actorEmail: users.email,
        actorDisplayName: users.discordUsername,
        actorRole: users.role,
        action: auditLogs.action,
        resourceType: auditLogs.resourceType,
        resourceId: auditLogs.resourceId,
        chapterId: chapters.id,
        chapterNumber: chapters.chapterNumber,
        chapterTitle: chapters.title,
        seriesId: series.id,
        seriesTitle: series.title,
        seriesSlug: series.slug,
        result: auditLogs.result,
        reasonCode: auditLogs.reasonCode,
        requestId: auditLogs.requestId,
        metadata: auditLogs.metadata,
        ipAddress: auditLogs.ipAddress,
        requestMethod: auditLogs.requestMethod,
        requestPath: auditLogs.requestPath,
        durationMs: auditLogs.durationMs,
        clientBrowser: auditLogs.clientBrowser,
        clientOperatingSystem: auditLogs.clientOperatingSystem,
        createdAt: auditLogs.createdAt,
      })
      .from(auditLogs)
      .leftJoin(users, eq(users.id, auditLogs.actorId))
      .leftJoin(
        chapters,
        and(
          eq(auditLogs.resourceType, "chapter"),
          eq(chapters.id, auditLogs.resourceId),
        ),
      )
      .leftJoin(
        series,
        or(
          and(
            eq(auditLogs.resourceType, "series"),
            eq(series.id, auditLogs.resourceId),
          ),
          eq(series.id, chapters.seriesId),
        ),
      )
      .where(
        and(
          filters,
          ...(cursor
            ? [
                or(
                  lt(auditLogs.createdAt, new Date(cursor.createdAt)),
                  and(
                    eq(auditLogs.createdAt, new Date(cursor.createdAt)),
                    lt(auditLogs.id, cursor.id),
                  ),
                ),
              ]
            : []),
        ),
      )
      .orderBy(desc(auditLogs.createdAt), desc(auditLogs.id))
      .limit(input.limit + 1),
    db
      .select({ total: count() })
      .from(auditLogs)
      .leftJoin(users, eq(users.id, auditLogs.actorId))
      .where(filters),
  ]);
  const page = rows.slice(0, input.limit);
  const last = page.at(-1);
  return {
    total: counted[0]?.total ?? 0,
    items: page.map((row) => ({
      id: row.id,
      actor: {
        id: row.actorId,
        email: row.actorEmail,
        displayName: row.actorDisplayName,
        role: row.actorRole,
      },
      action: row.action,
      resource: {
        type: row.resourceType,
        id: row.resourceId,
        chapter: row.chapterId
          ? {
              id: row.chapterId,
              number: row.chapterNumber,
              title: row.chapterTitle,
            }
          : null,
        series: row.seriesId
          ? {
              id: row.seriesId,
              title: row.seriesTitle,
              slug: row.seriesSlug,
            }
          : null,
      },
      result: row.result,
      reasonCode: row.reasonCode,
      requestId: row.requestId,
      metadata: safeMetadata(row.metadata as Record<string, unknown>),
      ipAddress: row.ipAddress,
      request: {
        method: row.requestMethod,
        endpoint: row.requestPath,
        durationMs: row.durationMs,
        browser: row.clientBrowser,
        operatingSystem: row.clientOperatingSystem,
      },
      createdAt: row.createdAt.toISOString(),
    })),
    nextCursor:
      rows.length > input.limit && last
        ? encodeCursor({
            createdAt: last.createdAt.toISOString(),
            id: last.id,
            query: signature,
          })
        : null,
  };
}

function parseQuery(value: unknown): AuditQuery {
  const parsed = querySchema.safeParse(value);
  if (!parsed.success) throw invalidQuery();
  if (parsed.data.from && parsed.data.to && parsed.data.from > parsed.data.to)
    throw invalidQuery();
  return parsed.data;
}
function invalidQuery() {
  return new AppError({
    code: "audit-query-invalid",
    detail: "The audit query is invalid.",
    statusCode: 422,
    title: "Invalid audit query",
    type: "https://nodeprox.dev/problems/audit-query-invalid",
  });
}
function querySignature(query: AuditQuery) {
  return JSON.stringify({
    from: query.from?.toISOString() ?? null,
    to: query.to?.toISOString() ?? null,
    action: query.action ?? null,
    actorId: query.actorId ?? null,
    resourceType: query.resourceType ?? null,
    result: query.result ?? null,
    search: query.search?.toLocaleLowerCase() ?? null,
  });
}
function encodeCursor(cursor: Cursor) {
  return Buffer.from(JSON.stringify(cursor)).toString("base64url");
}
function decodeCursor(value: string): Cursor {
  try {
    const parsed = JSON.parse(Buffer.from(value, "base64url").toString("utf8"));
    if (
      typeof parsed?.createdAt !== "string" ||
      Number.isNaN(new Date(parsed.createdAt).getTime()) ||
      typeof parsed?.id !== "string" ||
      typeof parsed?.query !== "string"
    )
      throw new Error("invalid-cursor");
    return parsed;
  } catch {
    throw invalidQuery();
  }
}
function safeMetadata(metadata: Record<string, unknown>) {
  return Object.fromEntries(
    Object.entries(metadata)
      .filter(([key]) => !isSensitiveKey(key))
      .slice(0, 30)
      .flatMap(([key, value]) => {
        const safeValue = sanitizeMetadataValue(value, 0);
        return safeValue === undefined ? [] : [[key, safeValue]];
      }),
  );
}

function sanitizeMetadataValue(value: unknown, depth: number): unknown {
  if (depth > 3) return undefined;
  if (
    value === null ||
    typeof value === "string" ||
    typeof value === "number" ||
    typeof value === "boolean"
  )
    return value;
  if (Array.isArray(value))
    return value.slice(0, 20).flatMap((entry) => {
      const sanitized = sanitizeMetadataValue(entry, depth + 1);
      return sanitized === undefined ? [] : [sanitized];
    });
  if (typeof value !== "object") return undefined;
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>)
      .filter(([key]) => !isSensitiveKey(key))
      .slice(0, 20)
      .flatMap(([key, entry]) => {
        const sanitized = sanitizeMetadataValue(entry, depth + 1);
        return sanitized === undefined ? [] : [[key, sanitized]];
      }),
  );
}

function isSensitiveKey(key: string) {
  return /(token|password|secret|authorization|cookie)/i.test(key);
}
function csvCell(value: string) {
  return `"${value.replaceAll('"', '""')}"`;
}
