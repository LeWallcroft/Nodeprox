import Fastify from "fastify";
import { describe, expect, it } from "vitest";
import { registerErrorHandler } from "../../../plugins/error-handler.js";
import {
  registerRequestContext,
  updateRequestContext,
} from "../../../plugins/request-context.js";
import { AuthorizationService } from "../application/services/authorization.service.js";
import { DefaultAuthorizationPolicy } from "../domain/policies/authorization.policy.js";
import { PERMISSIONS } from "../domain/permissions.js";
import { requirePermission } from "./authorization.plugin.js";

describe("authorization HTTP technical failure", () => {
  it("preserves 403 without exposing internal failureCode or error", async () => {
    const app = Fastify({ logger: false });
    const failing = new AuthorizationService(
      new DefaultAuthorizationPolicy(),
      {
        findRoleByUserId: async () => {
          throw new Error("password=private-value");
        },
      },
      { append: async () => {} },
      { getHelperCooldownDays: async () => 7 },
    );
    registerRequestContext(app);
    app.addHook("onRequest", (_request, _reply, done) => {
      updateRequestContext({ userId: "actor-1", sessionId: "session-1" });
      done();
    });
    registerErrorHandler(app);
    app.get(
      "/protected",
      { preHandler: requirePermission(failing, PERMISSIONS.SERIES_EDIT) },
      async () => ({ ok: true }),
    );
    const response = await app.inject({ method: "GET", url: "/protected" });
    expect(response.statusCode).toBe(403);
    expect(response.json()).toMatchObject({ code: "authorization-denied" });
    expect(response.body).not.toMatch(
      /failureCode|role-lookup-failed|private-value/,
    );
    await app.close();
  });
});
