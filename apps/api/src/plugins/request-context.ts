import { AsyncLocalStorage } from "node:async_hooks";
import type { RequestContext } from "@nodeprox/types";
import type { FastifyInstance } from "fastify";

const requestContextStorage = new AsyncLocalStorage<RequestContext>();

export function registerRequestContext(app: FastifyInstance): void {
  app.addHook("onRequest", (request, reply, done) => {
    const requestId = request.id;
    const context: RequestContext = { requestId };

    reply.header("x-request-id", requestId);
    requestContextStorage.run(context, done);
  });
}

export function getRequestContext(): RequestContext | undefined {
  return requestContextStorage.getStore();
}
