import { describe, expect, it, vi } from "vitest";
import { DELETE, GET, PATCH, POST } from "./route";

const context = (path: string[]) => ({ params: Promise.resolve({ path }) });

describe("same-origin API proxy", () => {
  it("forwards GET paths and query strings while preserving content type", async () => {
    const backend = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ status: "ok" }), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    );
    vi.stubGlobal("fetch", backend);

    const response = await GET(
      new Request("http://localhost:3000/api/health?check=1"),
      context(["health"]),
    );

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("application/json");
    await expect(response.json()).resolves.toEqual({ status: "ok" });
    expect(backend).toHaveBeenCalledWith(
      "http://localhost:3001/health?check=1",
      expect.objectContaining({ method: "GET" }),
    );
    vi.unstubAllGlobals();
  });

  it("forwards cookies and preserves Set-Cookie and Problem Details", async () => {
    const backendResponse = new Response(
      JSON.stringify({
        type: "https://nodeprox.dev/problems/authorization-denied",
        status: 403,
        detail: "Forbidden",
        code: "authorization-denied",
      }),
      { status: 403, headers: { "content-type": "application/problem+json" } },
    );
    backendResponse.headers.append(
      "set-cookie",
      "nodeprox_session=abc; HttpOnly; Path=/",
    );
    const backend = vi.fn().mockResolvedValue(backendResponse);
    vi.stubGlobal("fetch", backend);

    const response = await POST(
      new Request("http://localhost:3000/api/auth/login", {
        method: "POST",
        headers: {
          accept: "application/json",
          cookie: "nodeprox_session=old",
          origin: "http://localhost:3000",
          "content-type": "application/json",
        },
        body: JSON.stringify({ email: "x@example.com", password: "bad" }),
      }),
      context(["auth", "login"]),
    );

    const [, options] = backend.mock.calls[0] as [string, RequestInit];
    expect(response.status).toBe(403);
    expect(response.headers.get("set-cookie")).toContain(
      "nodeprox_session=abc",
    );
    await expect(response.json()).resolves.toMatchObject({
      status: 403,
      code: "authorization-denied",
    });
    expect(new Headers(options.headers).get("cookie")).toBe(
      "nodeprox_session=old",
    );
    expect(new Headers(options.headers).get("origin")).toBeNull();
    vi.unstubAllGlobals();
  });

  it("supports PATCH, DELETE and multipart request bodies", async () => {
    const backend = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ id: "series-1" }), { status: 200 }),
      )
      .mockResolvedValueOnce(new Response(null, { status: 204 }))
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ status: "uploaded" }), { status: 201 }),
      );
    vi.stubGlobal("fetch", backend);

    const patchResponse = await PATCH(
      new Request("http://localhost:3000/api/series/series-1", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ title: "Updated" }),
      }),
      context(["series", "series-1"]),
    );
    const deleteResponse = await DELETE(
      new Request("http://localhost:3000/api/series/series-1", {
        method: "DELETE",
      }),
      context(["series", "series-1"]),
    );
    const form = new FormData();
    form.append(
      "file",
      new File(["PK\x03\x04"], "chapter.zip", { type: "application/zip" }),
    );
    const uploadResponse = await POST(
      new Request("http://localhost:3000/api/chapters/chapter-1/upload", {
        method: "POST",
        body: form,
      }),
      context(["chapters", "chapter-1", "upload"]),
    );

    expect(patchResponse.status).toBe(200);
    expect(deleteResponse.status).toBe(204);
    expect(uploadResponse.status).toBe(201);
    expect(
      backend.mock.calls.map(([, options]) => (options as RequestInit).method),
    ).toEqual(["PATCH", "DELETE", "POST"]);
    expect(
      new Headers(backend.mock.calls[2]?.[1].headers).get("content-type"),
    ).toContain("multipart/form-data; boundary=");
    expect(backend.mock.calls[2]?.[1].body).toBeTruthy();
    vi.unstubAllGlobals();
  });

  it.each([401, 404, 409, 422, 500])(
    "preserves backend status %s",
    async (status) => {
      const backend = vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ status }), {
          status,
          headers: { "content-type": "application/problem+json" },
        }),
      );
      vi.stubGlobal("fetch", backend);
      const response = await GET(
        new Request("http://localhost:3000/api/series"),
        context(["series"]),
      );
      expect(response.status).toBe(status);
      vi.unstubAllGlobals();
    },
  );

  it("rejects invalid paths and contains backend connection errors", async () => {
    const invalid = await GET(
      new Request("http://localhost:3000/api/admin/raw"),
      context(["admin", "raw"]),
    );
    expect(invalid.status).toBe(404);

    vi.stubGlobal(
      "fetch",
      vi.fn().mockRejectedValue(new Error("backend unavailable")),
    );
    const unavailable = await GET(
      new Request("http://localhost:3000/api/health"),
      context(["health"]),
    );
    expect(unavailable.status).toBe(502);
    await expect(unavailable.json()).resolves.toMatchObject({
      code: "proxy-unavailable",
    });
    vi.unstubAllGlobals();
  });
});
