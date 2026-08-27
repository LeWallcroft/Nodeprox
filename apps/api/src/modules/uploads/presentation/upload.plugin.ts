import type { UploadTransferPort } from "@nodeprox/storage/port";
import type { NodeProxStorageConfig } from "@nodeprox/config";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import type { NodeProxDatabase } from "../../../../../../database/client.js";
import { AppError } from "../../../errors/app-error.js";
import { getRequestContext } from "../../../plugins/request-context.js";
import type { SessionCookieAdapter } from "../../authentication/infrastructure/http/session-cookie.adapter.js";
import type { SessionService } from "../../authentication/application/services/session.service.js";
import { requireSession } from "../../authentication/presentation/session-guards.js";
import type { ChapterPermissionService } from "../../chapters/application/services/chapter-permission.service.js";
import {
  ChapterUploadService,
  UploadConflictError,
  UploadDeniedError,
  UploadNotFoundError,
  UploadedObjectMismatchError,
  UploadedObjectNotFoundError,
  UploadProviderUnavailableError,
} from "../application/services/chapter-upload.service.js";
import {
  InvalidUploadError,
  UploadTooLargeError,
} from "../domain/upload.policy.js";
import { DrizzleUploadRepository } from "../infrastructure/persistence/drizzle/upload.repository.js";

const paramsSchema = z.object({ chapterId: z.uuid() }).strict();
const uploadParamsSchema = z
  .object({ chapterId: z.uuid(), uploadId: z.uuid() })
  .strict();
const initiateSchema = z
  .object({
    filename: z.string(),
    contentType: z.string(),
    sizeBytes: z.number(),
  })
  .strict();
const STALE_UPLOAD_SWEEP_MS = 15 * 60 * 1000;

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
  "upload-invalid",
  "The upload metadata is invalid.",
  422,
  "Invalid upload",
);
const unauthorized = problem(
  "authentication-required",
  "Authentication is required.",
  401,
  "Authentication required",
);
const forbidden = problem(
  "authorization-denied",
  "You are not authorized to upload this chapter.",
  403,
  "Forbidden",
);
const notFound = problem(
  "chapter-upload-not-found",
  "The requested chapter or upload was not found.",
  404,
  "Chapter upload not found",
);
const conflict = problem(
  "upload-conflict",
  "The upload conflicts with the current Chapter state.",
  409,
  "Upload conflict",
);
const objectMissing = problem(
  "upload-object-missing",
  "The uploaded object is not available for verification.",
  409,
  "Uploaded object missing",
);
const objectMismatch = problem(
  "upload-object-mismatch",
  "The uploaded object does not match the initiated upload.",
  422,
  "Uploaded object mismatch",
);
const tooLarge = problem(
  "upload-too-large",
  "The upload exceeds the configured limit.",
  413,
  "Upload too large",
);
const unsupported = problem(
  "upload-unsupported",
  "Only ZIP uploads are supported.",
  415,
  "Unsupported media type",
);
const providerUnavailable = problem(
  "upload-provider-unavailable",
  "The upload provider is temporarily unavailable.",
  503,
  "Upload provider unavailable",
);

function parse<T extends z.ZodType>(schema: T, value: unknown): z.infer<T> {
  const result = schema.safeParse(value);
  if (!result.success) throw invalid;
  return result.data;
}

function context() {
  const value = getRequestContext();
  if (!value?.userId || !value.sessionId) throw unauthorized;
  return { userId: value.userId, sessionId: value.sessionId };
}

function mapUploadError(error: unknown): never {
  if (error instanceof UploadDeniedError) throw forbidden;
  if (error instanceof UploadNotFoundError) throw notFound;
  if (error instanceof UploadConflictError) throw conflict;
  if (error instanceof UploadedObjectNotFoundError) throw objectMissing;
  if (error instanceof UploadedObjectMismatchError) throw objectMismatch;
  if (error instanceof UploadTooLargeError) throw tooLarge;
  if (error instanceof UploadProviderUnavailableError)
    throw providerUnavailable;
  if (error instanceof InvalidUploadError) {
    if (error.reason === "content-type") throw unsupported;
    throw invalid;
  }
  throw error;
}
export function registerUploadPlugin(
  app: FastifyInstance,
  db: NodeProxDatabase,
  authentication: { service: SessionService; cookies: SessionCookieAdapter },
  chapterPermissions: ChapterPermissionService,
  storageConfig: NodeProxStorageConfig,
  transfer: UploadTransferPort,
): void {
  const repository = new DrizzleUploadRepository(db);
  const service = new ChapterUploadService(
    chapterPermissions,
    repository,
    repository,
    transfer,
    repository,
    storageConfig.uploadMaxSizeBytes,
  );
  const session = requireSession(
    authentication.service,
    authentication.cookies,
  );

  app.post(
    "/chapters/:chapterId/uploads/initiate",
    { preHandler: session },
    async (request, reply) => {
      try {
        const { chapterId } = parse(paramsSchema, request.params);
        const body = parse(initiateSchema, request.body);
        return reply.code(201).send(
          await service.initiate({
            context: context(),
            chapterId,
            ...body,
          }),
        );
      } catch (error) {
        mapUploadError(error);
      }
    },
  );

  app.post(
    "/chapters/:chapterId/uploads/:uploadId/complete",
    { preHandler: session },
    async (request) => {
      try {
        const { chapterId, uploadId } = parse(
          uploadParamsSchema,
          request.params,
        );
        return await service.complete({
          context: context(),
          chapterId,
          uploadId,
        });
      } catch (error) {
        mapUploadError(error);
      }
    },
  );

  app.post(
    "/chapters/:chapterId/uploads/:uploadId/abort",
    { preHandler: session },
    async (request, reply) => {
      try {
        const { chapterId, uploadId } = parse(
          uploadParamsSchema,
          request.params,
        );
        await service.abort({ context: context(), chapterId, uploadId });
        return reply.code(204).send();
      } catch (error) {
        mapUploadError(error);
      }
    },
  );

  const sweep = setInterval(
    () =>
      void service.cleanupStale(
        new Date(
          Date.now() - (storageConfig.uploadPendingTtlSeconds ?? 86400) * 1000,
        ),
      ),
    STALE_UPLOAD_SWEEP_MS,
  );
  sweep.unref();
  app.addHook("onClose", async () => clearInterval(sweep));
}
