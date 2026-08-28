import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { AppError } from "../../../errors/app-error.js";
import {
  PublishedChapterIntegrityError,
  PublishedChapterNotFoundError,
} from "../application/services/get-published-chapter.js";
import type { GetPublishedChapter } from "../application/services/get-published-chapter.js";

const chapterIdSchema = z.object({ chapterId: z.uuid() }).strict();
const notFound = new AppError({
  code: "resource-not-found",
  detail: "The requested public chapter was not found.",
  statusCode: 404,
  title: "Resource not found",
  type: "https://nodeprox.dev/problems/resource-not-found",
});
const invalid = new AppError({
  code: "validation-failed",
  detail: "The request parameters are invalid.",
  statusCode: 422,
  title: "Validation failed",
  type: "https://nodeprox.dev/problems/validation-failed",
});
const internal = new AppError({
  code: "internal-error",
  detail: "The public chapter could not be published.",
  statusCode: 500,
  title: "Internal server error",
  type: "https://nodeprox.dev/problems/internal-error",
});

export function registerPublicationPlugin(
  app: FastifyInstance,
  service: GetPublishedChapter,
): void {
  app.get("/public/chapters/:chapterId", async (request) => {
    const params = chapterIdSchema.safeParse(request.params);
    if (!params.success) throw invalid;
    try {
      return await service.execute(params.data.chapterId);
    } catch (error) {
      if (error instanceof PublishedChapterNotFoundError) throw notFound;
      if (error instanceof PublishedChapterIntegrityError) throw internal;
      throw error;
    }
  });
}
