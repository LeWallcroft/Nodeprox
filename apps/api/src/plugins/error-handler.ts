import type { ProblemDetails } from "@nodeprox/types";
import type { FastifyInstance } from "fastify";
import { AppError } from "../errors/app-error.js";
import { getRequestContext } from "./request-context.js";

const internalError: ProblemDetails = {
  type: "https://nodeprox.dev/problems/internal-error",
  title: "Internal server error",
  status: 500,
  detail: "An unexpected error occurred.",
  code: "internal-error",
};

export function registerErrorHandler(app: FastifyInstance): void {
  app.setErrorHandler((error, request, reply) => {
    const context = getRequestContext();
    const requestId = context?.requestId ?? request.id;

    if (error instanceof AppError) {
      request.log.warn(
        { err: error, code: error.code, requestId },
        "Request failed with an application error",
      );
      return reply
        .status(error.statusCode)
        .type("application/problem+json")
        .send(error.toProblemDetails(request.url, requestId));
    }

    request.log.error({ err: error, requestId }, "Unhandled request error");
    return reply
      .status(500)
      .type("application/problem+json")
      .send({ ...internalError, instance: request.url, requestId });
  });
}
