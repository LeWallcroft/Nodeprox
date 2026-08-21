import { healthResponseSchema } from "@nodeprox/schemas";
import type { FastifyInstance } from "fastify";
import { parseWithSchema } from "../../http/validation.js";
import type { HealthService } from "./health.service.js";

export function registerHealthController(
  app: FastifyInstance,
  service: HealthService,
): void {
  app.get("/health", async () =>
    parseWithSchema(healthResponseSchema, service.getStatus()),
  );
}
