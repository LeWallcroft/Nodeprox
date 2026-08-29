import { describe, expect, it, vi } from "vitest";
import { DELETE, GET, PATCH, POST, PUT } from "./route";

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

  it("proxies the explicit Overview read model route", async () => {
    const backend = vi
      .fn()
      .mockResolvedValue(new Response("{}", { status: 200 }));
    vi.stubGlobal("fetch", backend);

    const response = await GET(
      new Request("http://localhost:3000/api/overview"),
      context(["overview"]),
    );

    expect(response.status).toBe(200);
    expect(backend).toHaveBeenCalledWith(
      "http://localhost:3001/overview",
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

  it("proxies registration without accepting client authority fields", async () => {
    const backend = vi
      .fn()
      .mockResolvedValue(new Response("{}", { status: 201 }));
    vi.stubGlobal("fetch", backend);
    const response = await POST(
      new Request("http://localhost:3000/api/auth/register", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          email: "new@example.com",
          password: "password123",
        }),
      }),
      context(["auth", "register"]),
    );
    expect(response.status).toBe(201);
    expect(backend).toHaveBeenCalledWith(
      "http://localhost:3001/auth/register",
      expect.objectContaining({ method: "POST" }),
    );
    vi.unstubAllGlobals();
  });

  it("supports PATCH, DELETE and upload metadata without proxying ZIP bytes", async () => {
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
    const uploadResponse = await POST(
      new Request(
        "http://localhost:3000/api/chapters/chapter-1/uploads/initiate",
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            filename: "chapter.zip",
            contentType: "application/zip",
            sizeBytes: 4,
          }),
        },
      ),
      context(["chapters", "chapter-1", "uploads", "initiate"]),
    );

    expect(patchResponse.status).toBe(200);
    expect(deleteResponse.status).toBe(204);
    expect(uploadResponse.status).toBe(201);
    expect(
      backend.mock.calls.map(([, options]) => (options as RequestInit).method),
    ).toEqual(["PATCH", "DELETE", "POST"]);
    expect(
      new Headers(backend.mock.calls[2]?.[1].headers).get("content-type"),
    ).toBe("application/json");
    expect(
      new Headers(backend.mock.calls[2]?.[1].headers).get("content-length"),
    ).toBeNull();
    expect(backend.mock.calls[2]?.[1].body).toBeTruthy();

    const legacy = await POST(
      new Request("http://localhost:3000/api/chapters/chapter-1/upload", {
        method: "POST",
        body: new Uint8Array([0x50, 0x4b]),
      }),
      context(["chapters", "chapter-1", "upload"]),
    );
    expect(legacy.status).toBe(404);
    expect(backend).toHaveBeenCalledTimes(3);
    vi.unstubAllGlobals();
  });

  it("proxies explicit global and contextual capability projections", async () => {
    const backend = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ capabilities: ["series.read"] }), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    );
    vi.stubGlobal("fetch", backend);
    const seriesId = "c56aef0e-da3d-42fc-8548-8eadcda8bdce";
    const chapterId = "b95822d0-4a53-4fab-92b2-d04f7a594d6f";

    const series = await GET(
      new Request(`http://localhost:3000/api/series/${seriesId}/capabilities`),
      context(["series", seriesId, "capabilities"]),
    );
    const chapter = await GET(
      new Request(
        `http://localhost:3000/api/chapters/${chapterId}/capabilities`,
      ),
      context(["chapters", chapterId, "capabilities"]),
    );
    const global = await GET(
      new Request("http://localhost:3000/api/auth/capabilities"),
      context(["auth", "capabilities"]),
    );
    const denied = await GET(
      new Request(`http://localhost:3000/api/series/${seriesId}/audit`),
      context(["series", seriesId, "audit"]),
    );

    expect(series.status).toBe(200);
    expect(chapter.status).toBe(200);
    expect(global.status).toBe(200);
    expect(denied.status).toBe(404);
    expect(await denied.json()).toMatchObject({ code: "invalid-proxy-path" });
    expect(backend.mock.calls.map(([url]) => url)).toEqual([
      `http://localhost:3001/series/${seriesId}/capabilities`,
      `http://localhost:3001/chapters/${chapterId}/capabilities`,
      "http://localhost:3001/auth/capabilities",
    ]);
    vi.unstubAllGlobals();
  });

  it("proxies only the contextual uploader assignment routes", async () => {
    const backend = vi
      .fn()
      .mockResolvedValue(new Response(null, { status: 204 }));
    vi.stubGlobal("fetch", backend);
    const seriesId = "c56aef0e-da3d-42fc-8548-8eadcda8bdce";

    const candidates = await GET(
      new Request(
        `http://localhost:3000/api/series/${seriesId}/uploader-candidates`,
      ),
      context(["series", seriesId, "uploader-candidates"]),
    );
    const assigned = await PUT(
      new Request(`http://localhost:3000/api/series/${seriesId}/uploader`, {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ uploaderId: "uploader-1" }),
      }),
      context(["series", seriesId, "uploader"]),
    );
    const cleared = await DELETE(
      new Request(`http://localhost:3000/api/series/${seriesId}/uploader`, {
        method: "DELETE",
      }),
      context(["series", seriesId, "uploader"]),
    );
    const blocked = await GET(
      new Request(`http://localhost:3000/api/series/${seriesId}/uploader/raw`),
      context(["series", seriesId, "uploader", "raw"]),
    );

    expect(candidates.status).toBe(204);
    expect(assigned.status).toBe(204);
    expect(cleared.status).toBe(204);
    expect(blocked.status).toBe(404);
    expect(backend).toHaveBeenCalledTimes(3);
    vi.unstubAllGlobals();
  });

  it("proxies the explicit global Chapters and helper-management routes", async () => {
    const backend = vi
      .fn()
      .mockResolvedValue(new Response("[]", { status: 200 }));
    vi.stubGlobal("fetch", backend);
    const chapterId = "b95822d0-4a53-4fab-92b2-d04f7a594d6f";
    await GET(
      new Request("http://localhost:3000/api/chapters"),
      context(["chapters"]),
    );
    await GET(
      new Request(
        `http://localhost:3000/api/chapters/${chapterId}/permissions`,
      ),
      context(["chapters", chapterId, "permissions"]),
    );
    await GET(
      new Request(
        `http://localhost:3000/api/chapters/${chapterId}/helper-candidates`,
      ),
      context(["chapters", chapterId, "helper-candidates"]),
    );
    expect(backend).toHaveBeenCalledTimes(3);
    vi.unstubAllGlobals();
  });

  it("proxies only explicit user administration and import batch routes", async () => {
    const backend = vi
      .fn()
      .mockResolvedValue(new Response("{}", { status: 200 }));
    vi.stubGlobal("fetch", backend);
    const seriesId = "series-1";
    const batchId = "batch-1";
    const itemId = "item-1";
    const userId = "user-1";
    expect(
      (
        await GET(
          new Request("http://localhost:3000/api/admin/users"),
          context(["admin", "users"]),
        )
      ).status,
    ).toBe(200);
    expect(
      (
        await PATCH(
          new Request(`http://localhost:3000/api/admin/users/${userId}`, {
            method: "PATCH",
          }),
          context(["admin", "users", userId]),
        )
      ).status,
    ).toBe(200);
    expect(
      (
        await POST(
          new Request(
            `http://localhost:3000/api/series/${seriesId}/import-batches`,
            { method: "POST" },
          ),
          context(["series", seriesId, "import-batches"]),
        )
      ).status,
    ).toBe(200);
    expect(
      (
        await GET(
          new Request(`http://localhost:3000/api/import-batches/${batchId}`),
          context(["import-batches", batchId]),
        )
      ).status,
    ).toBe(200);
    expect(
      (
        await POST(
          new Request(
            `http://localhost:3000/api/series/${seriesId}/import-batches/${batchId}/items/${itemId}/retry`,
            { method: "POST" },
          ),
          context([
            "series",
            seriesId,
            "import-batches",
            batchId,
            "items",
            itemId,
            "retry",
          ]),
        )
      ).status,
    ).toBe(200);
    expect(
      (
        await GET(
          new Request("http://localhost:3000/api/admin/users/raw"),
          context(["admin", "users", "raw"]),
        )
      ).status,
    ).toBe(404);
    expect(backend).toHaveBeenCalledTimes(5);
    vi.unstubAllGlobals();
  });

  it("proxies only the allowlisted product settings routes", async () => {
    const backend = vi
      .fn()
      .mockResolvedValue(new Response("{}", { status: 200 }));
    vi.stubGlobal("fetch", backend);
    expect(
      (
        await GET(
          new Request("http://localhost:3000/api/admin/settings"),
          context(["admin", "settings"]),
        )
      ).status,
    ).toBe(200);
    expect(
      (
        await PATCH(
          new Request("http://localhost:3000/api/admin/settings", {
            method: "PATCH",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ changes: [] }),
          }),
          context(["admin", "settings"]),
        )
      ).status,
    ).toBe(200);
    expect(
      (
        await GET(
          new Request("http://localhost:3000/api/admin/settings/raw"),
          context(["admin", "settings", "raw"]),
        )
      ).status,
    ).toBe(404);
    expect(backend).toHaveBeenCalledTimes(2);
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

  it.each([
    ["chapters", "chapter-1", "images"],
    ["images", "image-1"],
    ["images", "image-1", "content"],
    ["public", "chapters", "chapter-1"],
  ])("allows the F1 GET route %s", async (...path) => {
    const backend = vi
      .fn()
      .mockResolvedValue(
        new Response(JSON.stringify({ images: [] }), { status: 200 }),
      );
    vi.stubGlobal("fetch", backend);
    const response = await GET(
      new Request(`http://localhost:3000/api/${path.join("/")}`),
      context(path),
    );
    expect(response.status).toBe(200);
    vi.unstubAllGlobals();
  });

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
