import { afterEach, describe, expect, it, vi } from "vitest";
import { register } from "./api";
import { ACCOUNT_PENDING_MESSAGE, ACCOUNT_PENDING_PATH } from "./registration";

afterEach(() => vi.unstubAllGlobals());

describe("registration frontend contract", () => {
  it("registers without role authority and preserves pending account semantics", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          id: "user-id",
          email: "pending@example.test",
          status: "pending",
        }),
        { status: 201, headers: { "content-type": "application/json" } },
      ),
    );
    vi.stubGlobal("fetch", fetchMock);
    const result = await register({
      email: "pending@example.test",
      password: "pending-password",
    });
    expect(result.status).toBe("pending");
    const request = fetchMock.mock.calls[0]?.[1] as RequestInit;
    expect(request.body).toBe(
      JSON.stringify({
        email: "pending@example.test",
        password: "pending-password",
      }),
    );
    expect(request.body).not.toContain("role");
  });

  it("keeps the approved account-pending destination", () => {
    expect(ACCOUNT_PENDING_PATH).toBe("/account-pending");
    expect(ACCOUNT_PENDING_MESSAGE).toContain("pendiente de aprobación");
  });
});
