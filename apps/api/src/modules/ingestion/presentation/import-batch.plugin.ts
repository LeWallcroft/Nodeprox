import type { FastifyInstance } from "fastify";
import { z } from "zod";
import type { NodeProxDatabase } from "../../../../../../database/client.js";
import { AppError } from "../../../errors/app-error.js";
import { getRequestContext } from "../../../plugins/request-context.js";
import type { SessionService } from "../../authentication/application/services/session.service.js";
import type { SessionCookieAdapter } from "../../authentication/infrastructure/http/session-cookie.adapter.js";
import { requireSession } from "../../authentication/presentation/session-guards.js";
import { ChapterNumber } from "../../chapters/domain/chapter-number.js";
import type { SeriesService } from "../../series/application/services/series.service.js";
import {
  type ChapterUploadService,
  UploadConflictError,
} from "../../uploads/application/services/chapter-upload.service.js";
import { mapUploadError } from "../../uploads/presentation/upload.plugin.js";
import {
  ChapterImportBatchService,
  ImportBatchConflictError,
  ImportBatchDeniedError,
  ImportBatchNotFoundError,
} from "../application/chapter-import-batch.service.js";
import { ChapterTargetResolver } from "../application/chapter-target.resolver.js";
import { DrizzleImportBatchRepository } from "../infrastructure/persistence/drizzle/import-batch.repository.js";

const createSchema = z
  .object({
    items: z
      .array(
        z
          .object({
            clientId: z.string().trim().min(1).max(100),
            chapterNumber: z.number().finite().refine(ChapterNumber.isValid),
            filename: z.string().trim().min(1).max(255),
            contentType: z.string().trim().min(1).max(128),
            sizeBytes: z.number().int().positive(),
          })
          .strict(),
      )
      .min(1)
      .max(50),
  })
  .strict()
  .refine(
    ({ items }) =>
      new Set(items.map((item) => item.clientId)).size === items.length,
  );
const seriesParams = z.object({ seriesId: z.uuid() }).strict();
const batchParams = z.object({ batchId: z.uuid() }).strict();
const retryParams = z
  .object({
    seriesId: z.uuid(),
    batchId: z.uuid(),
    itemId: z.uuid(),
  })
  .strict();
const retrySchema = z
  .object({
    contentType: z.string().trim().min(1).max(128),
    sizeBytes: z.number().int().positive(),
  })
  .strict();

export function registerImportBatchPlugin(
  app: FastifyInstance,
  db: NodeProxDatabase,
  authentication: { service: SessionService; cookies: SessionCookieAdapter },
  series: SeriesService,
  uploads: ChapterUploadService,
) {
  const repository = new DrizzleImportBatchRepository(db);
  const targets = new ChapterTargetResolver(repository, {
    async create(input) {
      try {
        const result = await series.createChapter(input.actor, input.seriesId, {
          chapterNumber: input.chapterNumber,
        });
        if (!result) return { outcome: "not-found" as const };
        if ("forbidden" in result) return { outcome: "denied" as const };
        return { outcome: "created" as const, chapterId: result.id };
      } catch (error) {
        if (isUnique(error)) return { outcome: "conflict" as const };
        throw error;
      }
    },
  });
  const service = new ChapterImportBatchService(
    repository,
    {
      async check(actor, seriesId) {
        const result = await series.get(actor, seriesId);
        if (!result) return "not-found" as const;
        return "forbidden" in result
          ? ("denied" as const)
          : ("allowed" as const);
      },
    },
    targets,
    {
      async initiate(input) {
        try {
          const result = await uploads.initiate({
            context: input.actor,
            chapterId: input.chapterId,
            filename: input.filename,
            contentType: input.contentType,
            sizeBytes: input.sizeBytes,
          });
          return {
            outcome: "initiated" as const,
            uploadId: result.uploadId,
            transfer: result.transfer,
          };
        } catch (error) {
          if (error instanceof UploadConflictError)
            return { outcome: "conflict" as const };
          throw error;
        }
      },
      async abort(input) {
        await uploads.abort({
          context: input.actor,
          chapterId: input.chapterId,
          uploadId: input.uploadId,
        });
      },
    },
  );
  const session = requireSession(
    authentication.service,
    authentication.cookies,
  );

  app.post(
    "/series/:seriesId/import-batches",
    { preHandler: session },
    async (request, reply) => {
      try {
        const { seriesId } = parse(seriesParams, request.params);
        const { items } = parse(createSchema, request.body);
        return reply
          .code(201)
          .send(await service.create({ actor: context(), seriesId, items }));
      } catch (error) {
        throw mapError(error);
      }
    },
  );

  app.get(
    "/import-batches/:batchId",
    { preHandler: session },
    async (request) => {
      try {
        const { batchId } = parse(batchParams, request.params);
        return await service.get(context(), batchId);
      } catch (error) {
        throw mapError(error);
      }
    },
  );

  app.post(
    "/series/:seriesId/import-batches/:batchId/items/:itemId/retry",
    { preHandler: session },
    async (request, reply) => {
      try {
        const params = parse(retryParams, request.params);
        const body = parse(retrySchema, request.body);
        return reply.code(201).send(
          await service.retry({
            actor: context(),
            ...params,
            ...body,
          }),
        );
      } catch (error) {
        mapUploadError(mapError(error));
      }
    },
  );
}

function context() {
  const value = getRequestContext();
  if (!value?.userId || !value.sessionId)
    throw problem(
      "authentication-required",
      "Authentication is required.",
      401,
    );
  return { userId: value.userId, sessionId: value.sessionId };
}

function parse<T extends z.ZodType>(schema: T, value: unknown): z.infer<T> {
  const result = schema.safeParse(value);
  if (!result.success)
    throw problem("validation-failed", "The request payload is invalid.", 422);
  return result.data;
}

function mapError(error: unknown): unknown {
  if (error instanceof ImportBatchDeniedError)
    return problem(
      "authorization-denied",
      "The import batch is not authorized.",
      403,
    );
  if (error instanceof ImportBatchNotFoundError)
    return problem(
      "resource-not-found",
      "The import batch was not found.",
      404,
    );
  if (error instanceof ImportBatchConflictError)
    return problem(
      "chapter-conflict",
      "The Chapter cannot accept a new upload in its current state.",
      409,
    );
  return error;
}

function problem(code: string, detail: string, statusCode: number) {
  return new AppError({
    code,
    detail,
    statusCode,
    title:
      statusCode === 403
        ? "Forbidden"
        : statusCode === 404
          ? "Not found"
          : statusCode === 409
            ? "Conflict"
            : "Validation failed",
    type: `https://nodeprox.dev/problems/${code}`,
  });
}

function isUnique(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  if ("code" in error && error.code === "23505") return true;
  return "cause" in error && isUnique(error.cause);
}
