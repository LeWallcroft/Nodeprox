import { describe, expect, it } from "vitest";
import { getRequestContext } from "./request-context.js";

describe("request context", () => {
  it("is empty outside an active request", () => {
    expect(getRequestContext()).toBeUndefined();
  });
});
