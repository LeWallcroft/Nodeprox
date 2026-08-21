import Fastify, {
  type FastifyInstance,
  type FastifyServerOptions,
} from "fastify";
import { registerErrorHandler } from "./plugins/error-handler.js";
import { registerRequestContext } from "./plugins/request-context.js";
import { registerHealthController } from "./modules/health/health.controller.js";
import { HealthRepository } from "./modules/health/health.repository.js";
import { HealthService } from "./modules/health/health.service.js";

export function buildApp(options: FastifyServerOptions = {}): FastifyInstance {
  const app = Fastify({ logger: true, ...options });

  registerRequestContext(app);
  registerErrorHandler(app);
  registerHealthController(app, new HealthService(new HealthRepository()));

  return app;
}
