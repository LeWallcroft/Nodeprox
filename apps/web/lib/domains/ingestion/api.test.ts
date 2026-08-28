import { afterEach, describe, expect, it, vi } from "vitest";
import { retryImportItem } from "./api";

afterEach(() => vi.unstubAllGlobals());

describe("persistent import item retry API", () => {
  it("uses batchId/itemId and sends only current file metadata", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          itemId: "item-id",
          clientId: "client-26",
          chapterId: "chapter-id",
          uploadId: "new-upload-id",
          status: "uploading",
          transfer: {
            mode: "single",
            method: "PUT",
            url: "https://upload.example.test/grant",
            headers: { "content-type": "application/zip" },
            expiresAt: new Date().toISOString(),
          },
        }),
        { status: 201, headers: { "content-type": "application/json" } },
      ),
    );
    vi.stubGlobal("fetch", fetchMock);
    const result = await retryImportItem("series-id", "batch-id", "item-id", {
      contentType: "application/zip",
      sizeBytes: 128,
    });
    expect(result.uploadId).toBe("new-upload-id");
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/series/series-id/import-batches/batch-id/items/item-id/retry",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({
          contentType: "application/zip",
          sizeBytes: 128,
        }),
      }),
    );
    const request = fetchMock.mock.calls[0]?.[1] as RequestInit;
    expect(request.body).not.toContain("uploadId");
    expect(request.body).not.toContain("storageKey");
  });
});
