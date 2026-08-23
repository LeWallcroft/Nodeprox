import multipart from "@fastify/multipart";
import type { FastifyInstance } from "fastify";
import { Readable } from "node:stream";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { NodeProxDatabase } from "../../../../../../database/client.js";
import type { NodeProxStorageConfig } from "@nodeprox/config";
import { AppError } from "../../../errors/app-error.js";
import { getRequestContext } from "../../../plugins/request-context.js";
import type { AuthorizationService } from "../../authorization/application/services/authorization.service.js";
import type { SessionCookieAdapter } from "../../authentication/infrastructure/http/session-cookie.adapter.js";
import type { SessionService } from "../../authentication/application/services/session.service.js";
import { requireSession } from "../../authentication/presentation/session-guards.js";
import type { ChapterPermissionService } from "../../chapters/application/services/chapter-permission.service.js";
import {
  ChapterUploadService,
  UploadConflictError,
  UploadDeniedError,
  UploadNotFoundError,
} from "../application/services/chapter-upload.service.js";
import {
  InvalidUploadError,
  UploadTooLargeError,
} from "../domain/upload.policy.js";
import { B2Storage } from "../infrastructure/storage/b2.storage.js";
import { FilesystemStorage } from "../infrastructure/storage/filesystem.storage.js";
import { DrizzleUploadRepository } from "../infrastructure/persistence/drizzle/upload.repository.js";

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

const invalidMultipart = problem(
  "upload-invalid",
  "The upload is invalid.",
  400,
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
  "chapter-not-found",
  "The requested chapter was not found.",
  404,
  "Chapter not found",
);
const conflict = problem(
  "upload-conflict",
  "This chapter already has an upload.",
  409,
  "Upload conflict",
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
const unprocessable = problem(
  "upload-unprocessable",
  "The ZIP upload metadata is invalid.",
  422,
  "Unprocessable upload",
);

async function prefix(
  stream: NodeJS.ReadableStream,
): Promise<{ stream: NodeJS.ReadableStream; magicBytes: Uint8Array }> {
  const source = stream as Readable;
  const header = await new Promise<Buffer>((resolve, reject) => {
    const onData = (chunk: Buffer | string) => {
      source.pause();
      resolve(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    };
    source.once("data", onData);
    source.once("error", reject);
    source.once("end", () => resolve(Buffer.alloc(0)));
  });
  const combined = Readable.from(
    (async function* () {
      yield header;
      for await (const chunk of source) yield chunk;
    })(),
  );
  return { stream: combined, magicBytes: header.subarray(0, 4) };
}

export function registerUploadPlugin(
  app: FastifyInstance,
  db: NodeProxDatabase,
  authentication: { service: SessionService; cookies: SessionCookieAdapter },
  authorization: AuthorizationService,
  chapterPermissions: ChapterPermissionService,
  storageConfig: NodeProxStorageConfig,
): void {
  const repository = new DrizzleUploadRepository(db);
  const storage =
    storageConfig.provider === "b2"
      ? new B2Storage(storageConfig.b2)
      : new FilesystemStorage(join(tmpdir(), "nodeprox", "uploads"));
  const service = new ChapterUploadService(
    chapterPermissions,
    repository,
    storage,
    repository,
    storageConfig.uploadMaxSizeBytes,
  );
  const session = requireSession(
    authentication.service,
    authentication.cookies,
  );

  app.register(multipart, {
    limits: {
      files: 1,
      fields: 10,
      fileSize: storageConfig.uploadMaxSizeBytes,
    },
  });
  void authorization;
  app.post(
    "/chapters/:chapterId/upload",
    { preHandler: session },
    async (request, reply) => {
      const context = getRequestContext();
      if (!context?.userId || !context.sessionId) throw unauthorized;
      const params = request.params as { chapterId?: string };
      if (!params.chapterId) throw invalidMultipart;
      const part = await request.file().catch(() => null);
      if (part?.fieldname !== "file") throw invalidMultipart;
      const prepared = await prefix(part.file);
      try {
        const result = await service.upload({
          context: { userId: context.userId, sessionId: context.sessionId },
          chapterId: params.chapterId,
          file: {
            stream: prepared.stream,
            filename: part.filename,
            contentType: part.mimetype,
            sizeBytes: 0,
            magicBytes: prepared.magicBytes,
            isTruncated: () => part.file.truncated,
          },
        });
        return reply.code(201).send(result);
      } catch (error) {
        if (error instanceof UploadDeniedError) throw forbidden;
        if (error instanceof UploadNotFoundError) throw notFound;
        if (error instanceof UploadConflictError) throw conflict;
        if (error instanceof UploadTooLargeError) throw tooLarge;
        if (error instanceof InvalidUploadError) {
          if (error.reason === "content-type") throw unsupported;
          throw unprocessable;
        }
        throw error;
      }
    },
  );
}
