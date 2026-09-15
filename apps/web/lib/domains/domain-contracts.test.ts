import { describe, expect, it, vi } from "vitest";
import { normalizeApiError } from "../api/types";
import { createChapter, listChapters } from "./chapters/api";
import { getPublicChapter } from "./publication/api";
import { queryKeys } from "./query-keys";
import {
  createSeries,
  deleteSeries,
  getSelectableSeriesChannels,
  listSeries,
} from "./series/api";
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
    expect(queryKeys.ingestion.batch("batch-1")).toEqual([
      "ingestion",
      "batch",
      "batch-1",
    ]);
    expect(queryKeys.publication.chapter("chapter-1")).toEqual([
      "public",
      "chapters",
      "chapter-1",
    ]);
    expect(queryKeys.notifications.list()).toEqual(["notifications", "list"]);
    expect(queryKeys.notifications.unreadCount()).toEqual([
      "notifications",
      "unread-count",
    ]);
    expect(queryKeys.discord.seriesChannels).toEqual([
      "discord",
      "series-channels",
    ]);
  });

  it("uses the public chapter manifest route and preserves its public URL", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          id: "chapter-1",
          images: [{ url: "https://media.nodeprox.org/image.webp" }],
        }),
        { status: 200 },
      ),
    );
    vi.stubGlobal("fetch", fetchMock);
    const manifest = await getPublicChapter("chapter-1");
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/public/chapters/chapter-1",
      expect.objectContaining({ credentials: "include" }),
    );
    expect(manifest.images[0]?.url).toBe(
      "https://media.nodeprox.org/image.webp",
    );
    vi.unstubAllGlobals();
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

  it("uses the authenticated channel listing and sends only a selected channel id", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ items: [] }), { status: 200 }),
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ id: "series" }), { status: 201 }),
      );
    vi.stubGlobal("fetch", fetchMock);

    await getSelectableSeriesChannels();
    await createSeries({
      title: "Series",
      discordChannelId: "12345678901234567",
    });

    expect(fetchMock.mock.calls.map(([url]) => url)).toEqual([
      "/api/me/discord/series-channels",
      "/api/series",
    ]);
    expect(JSON.parse(fetchMock.mock.calls[1]?.[1].body as string)).toEqual({
      title: "Series",
      discordChannelId: "12345678901234567",
    });
    vi.unstubAllGlobals();
  });

  it("sends only metadata through /api and transfers ZIP bytes directly", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            chapterId: "chapter-1",
            uploadId: "upload-1",
            status: "pending",
            filename: "chapter.zip",
            sizeBytes: 4,
            transfer: {
              mode: "single",
              method: "PUT",
              url: "https://s3.example.test/direct-upload",
              headers: { "content-type": "application/zip" },
              expiresAt: new Date(Date.now() + 60_000).toISOString(),
            },
          }),
          { status: 201 },
        ),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            chapterId: "chapter-1",
            uploadId: "upload-1",
            status: "uploaded",
            filename: "chapter.zip",
            sizeBytes: 4,
          }),
          { status: 200 },
        ),
      );
    vi.stubGlobal("fetch", fetchMock);
    const directRequests: FakeDirectRequest[] = [];
    class FakeDirectRequest {
      status = 200;
      readonly upload = { addEventListener: vi.fn() };
      readonly listeners = new Map<string, () => void>();
      open = vi.fn();
      setRequestHeader = vi.fn();
      addEventListener = vi.fn((name: string, listener: () => void) => {
        this.listeners.set(name, listener);
      });
      send = vi.fn(() => this.listeners.get("load")?.());
      constructor() {
        directRequests.push(this);
      }
    }
    vi.stubGlobal("XMLHttpRequest", FakeDirectRequest);
    const file = new File(["PK\x03\x04"], "chapter.zip", {
      type: "application/x-zip-compressed",
    });
    const initiated = vi.fn(() => expect(directRequests).toHaveLength(0));
    await uploadChapter("chapter-1", file, undefined, initiated);
    expect(initiated).toHaveBeenCalledOnce();
    expect(fetchMock.mock.calls.map(([url]) => url)).toEqual([
      "/api/chapters/chapter-1/uploads/initiate",
      "/api/chapters/chapter-1/uploads/upload-1/complete",
    ]);
    const initiateCall = fetchMock.mock.calls[0];
    if (!initiateCall) throw new Error("expected initiate request");
    const metadata = JSON.parse(
      (initiateCall[1] as RequestInit).body as string,
    );
    expect(metadata).toEqual({
      filename: "chapter.zip",
      contentType: "application/zip",
      sizeBytes: 4,
    });
    expect(directRequests[0]?.open).toHaveBeenCalledWith(
      "PUT",
      "https://s3.example.test/direct-upload",
    );
    expect(directRequests[0]?.send).toHaveBeenCalledWith(file);
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
