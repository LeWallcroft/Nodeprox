import type { FastifyInstance } from "fastify";
import { z } from "zod";
import type { NodeProxDatabase } from "../../../../../../database/client.js";
import type { StoragePort } from "@nodeprox/storage/port";
import { AppError } from "../../../errors/app-error.js";
import { getRequestContext } from "../../../plugins/request-context.js";
import type { SessionCookieAdapter } from "../../authentication/infrastructure/http/session-cookie.adapter.js";
import type { SessionService } from "../../authentication/application/services/session.service.js";
import { requireSession } from "../../authentication/presentation/session-guards.js";
import type { ChapterPermissionService } from "../../chapters/application/services/chapter-permission.service.js";
import { ImageQueryService } from "../application/services/image-query.service.js";
import {
  ChapterNotFoundError,
  ImageAccessDeniedError,
  ImageContentInfrastructureError,
  ImageContentNotFoundError,
  ImageNotFoundError,
} from "../application/services/image-query.service.js";
import { DrizzleImageRepository } from "../infrastructure/persistence/drizzle/image.repository.js";

const idSchema = z.object({ chapterId: z.uuid() }).strict();
const imageIdSchema = z.object({ imageId: z.uuid() }).strict();

const problem = (
  code: string,
  detail: string,
  statusCode: number,
  title: string,
) =>
  new AppError({
    code,
    detail,
    statusCode,
    title,
    type: `https://nodeprox.dev/problems/${code}`,
  });

const invalid = problem(
  "validation-failed",
  "The request parameters are invalid.",
  422,
  "Validation failed",
);
const forbidden = problem(
  "authorization-denied",
  "You are not authorized to access this image.",
  403,
  "Forbidden",
);
const chapterNotFound = problem(
  "chapter-not-found",
  "The requested chapter was not found.",
  404,
  "Chapter not found",
);
const imageNotFound = problem(
  "image-not-found",
  "The requested image was not found.",
  404,
  "Image not found",
);
const contentNotFound = problem(
  "image-content-not-found",
  "The image content was not found.",
  404,
  "Image content not found",
);
const internal = problem(
  "internal-error",
  "The image content could not be served.",
  500,
  "Internal server error",
);

function parse<T extends z.ZodType>(schema: T, input: unknown): z.infer<T> {
  const result = schema.safeParse(input);
  if (!result.success) throw invalid;
  return result.data;
}

function context() {
  const value = getRequestContext();
  if (!value?.userId || !value.sessionId) throw forbidden;
  return { userId: value.userId, sessionId: value.sessionId };
}

export function registerImagePlugin(
  app: FastifyInstance,
  db: NodeProxDatabase,
  authentication: { service: SessionService; cookies: SessionCookieAdapter },
  chapterPermissions: ChapterPermissionService,
  storage: StoragePort,
): void {
  const service = new ImageQueryService(
    new DrizzleImageRepository(db),
    chapterPermissions,
    storage,
  );
  const session = requireSession(
    authentication.service,
    authentication.cookies,
  );

  app.get(
    "/chapters/:chapterId/images",
    { preHandler: session },
    async (request) => {
      const { chapterId } = parse(idSchema, request.params);
      try {
        return { images: await service.list(context(), chapterId) };
      } catch (error) {
        throw mapError(error);
      }
    },
  );

  app.get("/images/:imageId", { preHandler: session }, async (request) => {
    const { imageId } = parse(imageIdSchema, request.params);
    try {
      return await service.getMetadata(context(), imageId);
    } catch (error) {
      throw mapError(error);
    }
  });

  app.get(
    "/images/:imageId/content",
    { preHandler: session },
    async (request, reply) => {
      const { imageId } = parse(imageIdSchema, request.params);
      try {
        const result = await service.getContent(context(), imageId);
        reply.header("Content-Type", result.image.contentType);
        reply.header("Content-Length", result.image.sizeBytes);
        reply.header("Content-Disposition", "inline");
        reply.header("X-Content-Type-Options", "nosniff");
        return reply.send(result.stream);
      } catch (error) {
        throw mapError(error);
      }
    },
  );
}

function mapError(error: unknown): AppError {
  if (error instanceof ChapterNotFoundError) return chapterNotFound;
  if (error instanceof ImageNotFoundError) return imageNotFound;
  if (error instanceof ImageAccessDeniedError) return forbidden;
  if (error instanceof ImageContentNotFoundError) return contentNotFound;
  if (error instanceof ImageContentInfrastructureError) return internal;
  return error instanceof AppError ? error : internal;
}
