import { describe, expect, it, vi } from "vitest";
import { normalizeApiError } from "../api/types";
import { createChapter, listChapters } from "./chapters/api";
import { queryKeys } from "./query-keys";
import { deleteSeries, listSeries } from "./series/api";
import { uploadChapter } from "./uploads/api";

describe("frontend domain contract adapters", () => {
  it("keeps domain query keys stable", () => {
    expect(queryKeys.auth.session).toEqual(["auth", "session"]);
    expect(queryKeys.series.detail("series-1")).toEqual([
      "series",
      "detail",
      "series-1",
    ]);
    expect(queryKeys.series.chapters("series-1")).toEqual([
      "series",
      "series-1",
      "chapters",
    ]);
    expect(queryKeys.chapters.detail("chapter-1")).toEqual([
      "chapters",
      "detail",
      "chapter-1",
    ]);
  });

  it("uses the real Series and Chapter routes", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(new Response(JSON.stringify([]), { status: 200 }))
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ id: "chapter-1" }), { status: 201 }),
      )
      .mockResolvedValueOnce(new Response(JSON.stringify([]), { status: 200 }))
      .mockResolvedValueOnce(new Response(null, { status: 204 }));
    vi.stubGlobal("fetch", fetchMock);

    await listSeries();
    await createChapter("series-1", { chapterNumber: 1, title: null });
    await listChapters("series-1");
    await deleteSeries("series-1");

    expect(fetchMock.mock.calls.map(([url]) => url)).toEqual([
      "/api/series",
      "/api/series/series-1/chapters",
      "/api/series/series-1/chapters",
      "/api/series/series-1",
    ]);
    vi.unstubAllGlobals();
  });

  it("sends uploads as multipart with the required file field", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          chapterId: "chapter-1",
          uploadId: "upload-1",
          status: "uploaded",
          filename: "chapter.zip",
          sizeBytes: 4,
        }),
        { status: 201 },
      ),
    );
    vi.stubGlobal("fetch", fetchMock);
    const file = new File(["PK\x03\x04"], "chapter.zip", {
      type: "application/zip",
    });
    await uploadChapter("chapter-1", file);
    const request = fetchMock.mock.calls[0]?.[1] as RequestInit;
    expect(request.method).toBe("POST");
    expect(request.body).toBeInstanceOf(FormData);
    expect((request.body as FormData).get("file")).toBeInstanceOf(File);
    expect((request.body as FormData).get("file")).toMatchObject({
      name: "chapter.zip",
    });
    vi.unstubAllGlobals();
  });

  it("maps backend Problem Details without exposing unknown payloads", () => {
    const error = normalizeApiError(403, {
      type: "https://nodeprox.dev/problems/authorization-denied",
      title: "Forbidden",
      status: 403,
      detail: "No autorizado.",
      code: "authorization-denied",
      requestId: "request-1",
    });
    expect(error.status).toBe(403);
    expect(error.code).toBe("authorization-denied");
    expect(error.message).toBe("No autorizado.");
    expect(error.details?.requestId).toBe("request-1");
  });
});
