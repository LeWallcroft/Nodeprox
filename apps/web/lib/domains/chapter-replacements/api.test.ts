import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  completeChapterReplacement,
  getChapterReplacement,
  prepareChapterReplacement,
  startChapterReplacement,
} from "./api";

const fetchMock = vi.fn();

beforeEach(() => {
  fetchMock.mockReset();
  vi.stubGlobal("fetch", fetchMock);
});

function response(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

describe("whole Chapter replacement Web API", () => {
  it("CHR4-WEB-API-01 prepare sends only ZIP metadata", async () => {
    fetchMock.mockResolvedValue(
      response({ replacementId: "r1", chapterId: "c1", upload: {} }, 201),
    );
    await prepareChapterReplacement({
      chapterId: "c1",
      file: new File(["zip"], "chapter.zip", { type: "application/zip" }),
    });
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/chapters/c1/replacement-session",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({
          filename: "chapter.zip",
          contentType: "application/zip",
          sizeBytes: 3,
        }),
      }),
    );
    expect(fetchMock.mock.calls[0]?.[1]?.body).not.toContain("storageKey");
  });

  it("CHR4-WEB-API-02 complete and status use replacement paths without authority bodies", async () => {
    fetchMock
      .mockResolvedValueOnce(
        response({
          replacementId: "r1",
          chapterId: "c1",
          status: "processing",
        }),
      )
      .mockResolvedValueOnce(
        response({
          replacementId: "r1",
          chapterId: "c1",
          status: "processing",
        }),
      );
    await completeChapterReplacement({ chapterId: "c1", replacementId: "r1" });
    await getChapterReplacement({ chapterId: "c1", replacementId: "r1" });
    expect(fetchMock.mock.calls[0]).toEqual([
      "/api/chapters/c1/replacements/r1/complete",
      { method: "POST", credentials: "include" },
    ]);
    expect(fetchMock.mock.calls[1]?.[0]).toBe(
      "/api/chapters/c1/replacements/r1",
    );
  });

  it("CHR4-WEB-API-03 executes prepare, direct PUT, then complete", async () => {
    class FakeXhr {
      status = 200;
      upload = { addEventListener: vi.fn() };
      listeners = new Map<string, () => void>();
      open = vi.fn();
      setRequestHeader = vi.fn();
      addEventListener = (name: string, listener: () => void) =>
        this.listeners.set(name, listener);
      send = vi.fn(() => this.listeners.get("load")?.());
    }
    const xhr = new FakeXhr();
    vi.stubGlobal(
      "XMLHttpRequest",
      vi.fn(() => xhr),
    );
    fetchMock
      .mockResolvedValueOnce(
        response(
          {
            replacementId: "r1",
            chapterId: "c1",
            upload: {
              mode: "single",
              method: "PUT",
              url: "https://upload.example.test/signed",
              headers: { "content-type": "application/zip" },
              expiresAt: new Date().toISOString(),
            },
          },
          201,
        ),
      )
      .mockResolvedValueOnce(
        response(
          { replacementId: "r1", chapterId: "c1", status: "uploaded" },
          202,
        ),
      );
    await startChapterReplacement({
      chapterId: "c1",
      file: new File(["zip"], "chapter.zip", { type: "application/zip" }),
    });
    expect(xhr.open).toHaveBeenCalledWith(
      "PUT",
      "https://upload.example.test/signed",
    );
    expect(fetchMock.mock.calls[1]?.[0]).toBe(
      "/api/chapters/c1/replacements/r1/complete",
    );
  });
});
