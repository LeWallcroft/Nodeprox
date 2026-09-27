import type { FastifyBaseLogger } from "fastify";
import { getRequestContext } from "../plugins/request-context.js";
import { sanitizeOperationalText } from "./sanitize-operational-text.js";

/** Shared logging mechanism; bounded contexts retain their own failure codes. */
export class PinoAuthorizationFailureReporter {
  constructor(private readonly logger: FastifyBaseLogger) {}

  report(input: {
    code: string;
    operation: string;
    actorId?: string;
    requestId?: string;
    permission?: string;
    resourceType?: string;
    resourceId?: string;
    error?: unknown;
  }): void {
    const error = input.error;
    this.logger.warn(
      {
        code: input.code,
        operation: input.operation,
        requestId: input.requestId ?? getRequestContext()?.requestId,
        actorId: input.actorId,
        permission: input.permission,
        resourceType: input.resourceType,
        resourceId: input.resourceId,
        errorName:
          error instanceof Error
            ? sanitizeOperationalText(error.name).slice(0, 80)
            : undefined,
        errorMessage:
          error instanceof Error
            ? sanitizeOperationalText(error.message).slice(0, 512)
            : undefined,
      },
      "Authorization technical failure",
    );
  }
}
