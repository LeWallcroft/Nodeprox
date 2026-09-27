import { describe, expect, it, vi } from "vitest";
import { PinoAuthorizationFailureReporter } from "../../apps/api/src/observability/pino-authorization-failure-reporter.js";

describe("authorization failure diagnostics", () => {
  it("emits structured sanitized data without the raw error", () => {
    const warn = vi.fn();
    const reporter = new PinoAuthorizationFailureReporter({
      warn,
    } as unknown as ConstructorParameters<
      typeof PinoAuthorizationFailureReporter
    >[0]);
    reporter.report({
      code: "role-lookup-failed",
      operation: "authorize",
      actorId: "actor-1",
      requestId: "request-1",
      permission: "series.edit",
      resourceType: "series",
      resourceId: "series-1",
      error: new Error(
        "password=secret token=abc https://example.test/signed?key=secret",
      ),
    });
    expect(warn).toHaveBeenCalledTimes(1);
    const [fields] = warn.mock.calls[0] as [Record<string, unknown>];
    expect(fields).toMatchObject({
      code: "role-lookup-failed",
      operation: "authorize",
      actorId: "actor-1",
      requestId: "request-1",
      permission: "series.edit",
      resourceType: "series",
      resourceId: "series-1",
      errorName: "Error",
    });
    expect(JSON.stringify(fields)).not.toMatch(
      /password=secret|token=abc|example\.test|signed\?key/,
    );
    expect(fields).not.toHaveProperty("error");
  });
});
