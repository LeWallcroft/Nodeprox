import type { UploadTransferGrant } from "@nodeprox/storage/port";
import {
  UploadTransferObjectNotFoundError,
  UploadTransferProviderError,
} from "@nodeprox/storage/port";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { z } from "zod";
import { AppError } from "../../../errors/app-error.js";
import { getRequestContext } from "../../../plugins/request-context.js";
import {
  InvalidUploadError,
  UploadTooLargeError,
} from "../../uploads/domain/upload.policy.js";
import {
  ChapterReplacementActivationConflictError,
  ChapterReplacementActivationDeniedError,
  ChapterReplacementActivationInvariantError,
  ChapterReplacementActivationNotFoundError,
} from "../application/chapter-media-activation.service.js";
import {
  ChapterReplacementUploadDeniedError,
  ChapterReplacementUploadFailedError,
  ChapterReplacementUploadInvalidError,
  ChapterReplacementUploadInvariantError,
  ChapterReplacementUploadNotFoundError,
  ChapterReplacementUploadProviderError,
  type CompleteChapterReplacementUploadService,
} from "../application/complete-chapter-replacement-upload.service.js";
import {
  ChapterReplacementDeniedError,
  ChapterReplacementInvalidStateError,
  ChapterReplacementInvariantError,
  ChapterReplacementNotFoundError,
  type ChapterReplacementProjection,
  type FinalizeChapterReplacementService,
} from "../application/finalize-chapter-replacement.service.js";
import {
  ChapterReplacementPrepareConflictError,
  ChapterReplacementPrepareDeniedError,
  ChapterReplacementPrepareNotFoundError,
  ChapterReplacementPrepareProviderError,
  type PrepareChapterReplacementService,
} from "../application/prepare-chapter-replacement.service.js";

const chapterParams = z.object({ chapterId: z.uuid() }).strict();
const replacementParams = z
  .object({ chapterId: z.uuid(), replacementId: z.uuid() })
  .strict();
const prepareBody = z
  .object({
    filename: z.string(),
    contentType: z.string(),
    sizeBytes: z.number(),
  })
  .strict();
const emptyBody = z.object({}).strict().optional();
const uploadGrant = z.discriminatedUnion("mode", [
  z
    .object({
      mode: z.literal("single"),
      method: z.literal("PUT"),
      url: z.url(),
      headers: z.record(z.string(), z.string()),
      expiresAt: z.string(),
    })
    .strict(),
  z
    .object({
      mode: z.literal("multipart"),
      partSizeBytes: z.number().int().positive(),
      parts: z.array(
        z
          .object({
            partNumber: z.number().int().positive(),
            method: z.literal("PUT"),
            url: z.url(),
            headers: z.record(z.string(), z.string()),
          })
          .strict(),
      ),
      expiresAt: z.string(),
    })
    .strict(),
]);
const resultSchema = z
  .object({
    replacementId: z.uuid(),
    chapterId: z.uuid(),
    previousImageCount: z.number().int().nonnegative(),
    imageCount: z.number().int().nonnegative(),
    retainedImageCount: z.number().int().nonnegative(),
    createdImageCount: z.number().int().nonnegative(),
    retiredImageCount: z.number().int().nonnegative(),
    completedAt: z.date(),
  })
  .strict();
const projectionSchema = z
  .object({
    replacementId: z.uuid(),
    chapterId: z.uuid(),
    status: z.enum([
      "pending_upload",
      "uploaded",
      "processing",
      "ready",
      "completing",
      "completed",
      "failed",
    ]),
    errorCode: z.string().optional(),
    result: resultSchema.optional(),
  })
  .strict();

type SessionGuard = (
  request: FastifyRequest,
  reply: FastifyReply,
) => Promise<void>;

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
  "chapter-replacement-invalid",
  "The Chapter replacement request is invalid.",
  400,
  "Invalid Chapter replacement",
);
const unsupported = problem(
  "chapter-replacement-unsupported",
  "Only ZIP uploads are supported.",
  415,
  "Unsupported media type",
);
const tooLarge = problem(
  "chapter-replacement-too-large",
  "The ZIP exceeds the configured limit.",
  413,
  "Replacement too large",
);
const forbidden = problem(
  "authorization-denied",
  "You are not authorized to replace this Chapter.",
  403,
  "Forbidden",
);
const notFound = problem(
  "chapter-replacement-not-found",
  "The requested Chapter replacement was not found.",
  404,
  "Chapter replacement not found",
);
const conflict = problem(
  "chapter-replacement-conflict",
  "The Chapter replacement conflicts with its current state.",
  409,
  "Chapter replacement conflict",
);
const candidateMissing = problem(
  "chapter-replacement-upload-missing",
  "The uploaded replacement ZIP was not found.",
  404,
  "Replacement upload not found",
);
const providerUnavailable = problem(
  "upload-provider-unavailable",
  "The upload provider is temporarily unavailable.",
  503,
  "Upload provider unavailable",
);
const internal = problem(
  "internal-error",
  "The Chapter replacement could not be processed.",
  500,
  "Internal server error",
);

export function registerChapterReplacementPlugin(
  app: FastifyInstance,
  dependencies: {
    prepare: PrepareChapterReplacementService;
    completeUpload: CompleteChapterReplacementUploadService;
    finalize: FinalizeChapterReplacementService;
    sessionGuard: SessionGuard;
  },
): void {
  app.post(
    "/chapters/:chapterId/replacement-session",
    { preHandler: dependencies.sessionGuard },
    async (request, reply) => {
      try {
        const { chapterId } = parse(chapterParams, request.params);
        const body = parse(prepareBody, request.body);
        const prepared = await dependencies.prepare.execute({
          context: context(),
          chapterId,
          ...body,
        });
        return reply.code(201).send({
          replacementId: prepared.replacementId,
          chapterId: prepared.chapterId,
          upload: uploadGrant.parse(
            prepared.upload satisfies UploadTransferGrant,
          ),
        });
      } catch (error) {
        throw mapError(error);
      }
    },
  );

  app.post(
    "/chapters/:chapterId/replacements/:replacementId/complete",
    { preHandler: dependencies.sessionGuard },
    async (request, reply) => {
      try {
        const params = parse(replacementParams, request.params);
        parse(emptyBody, request.body);
        const result = await dependencies.completeUpload.execute({
          context: context(),
          ...params,
        });
        if ("imageCount" in result)
          return reply.code(200).send(
            projectionSchema.parse({
              replacementId: result.replacementId,
              chapterId: result.chapterId,
              status: "completed",
              result,
            }),
          );
        return reply.code(202).send(projectionSchema.parse(result));
      } catch (error) {
        throw mapError(error);
      }
    },
  );

  app.get(
    "/chapters/:chapterId/replacements/:replacementId",
    { preHandler: dependencies.sessionGuard },
    async (request, reply) => {
      try {
        const params = parse(replacementParams, request.params);
        const requestId = getRequestContext()?.requestId;
        const projection = await dependencies.finalize.execute({
          context: context(),
          ...params,
          ...(requestId ? { requestId } : {}),
        });
        return reply.code(200).send(safeProjection(projection));
      } catch (error) {
        throw mapError(error);
      }
    },
  );
}

function parse<T extends z.ZodType>(schema: T, value: unknown): z.infer<T> {
  const result = schema.safeParse(value);
  if (!result.success) throw invalid;
  return result.data;
}

function context() {
  const value = getRequestContext();
  if (!value?.userId || !value.sessionId) throw forbidden;
  return { userId: value.userId, sessionId: value.sessionId };
}

function safeProjection(projection: ChapterReplacementProjection) {
  return projectionSchema.parse(projection);
}

function mapError(error: unknown): AppError {
  if (
    error instanceof ChapterReplacementPrepareDeniedError ||
    error instanceof ChapterReplacementUploadDeniedError ||
    error instanceof ChapterReplacementDeniedError ||
    error instanceof ChapterReplacementActivationDeniedError
  )
    return forbidden;
  if (
    error instanceof ChapterReplacementPrepareNotFoundError ||
    error instanceof ChapterReplacementUploadNotFoundError ||
    error instanceof ChapterReplacementNotFoundError ||
    error instanceof ChapterReplacementActivationNotFoundError
  )
    return notFound;
  if (error instanceof UploadTransferObjectNotFoundError)
    return candidateMissing;
  if (
    error instanceof UploadTransferProviderError ||
    error instanceof ChapterReplacementPrepareProviderError ||
    error instanceof ChapterReplacementUploadProviderError
  )
    return providerUnavailable;
  if (error instanceof InvalidUploadError)
    return error.reason === "content-type" ? unsupported : invalid;
  if (error instanceof UploadTooLargeError) return tooLarge;
  if (
    error instanceof ChapterReplacementPrepareConflictError ||
    error instanceof ChapterReplacementUploadFailedError ||
    error instanceof ChapterReplacementInvalidStateError ||
    error instanceof ChapterReplacementActivationConflictError ||
    error instanceof ChapterReplacementUploadInvalidError
  )
    return conflict;
  if (
    error instanceof ChapterReplacementUploadInvariantError ||
    error instanceof ChapterReplacementInvariantError ||
    error instanceof ChapterReplacementActivationInvariantError
  )
    return internal;
  return error instanceof AppError ? error : internal;
}
