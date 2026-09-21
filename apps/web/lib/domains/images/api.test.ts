import { afterEach, describe, expect, it, vi } from "vitest";
import {
  completeImageReplacement,
  ImageReplacementFileValidationError,
  prepareImageReplacement,
  replaceChapterImage,
  selectSingleImageReplacementFile,
  validateImageReplacementFile,
} from "./api";

const preparedReplacement = {
  replacementId: "replacement-1",
  imageId: "image-1",
  upload: {
    mode: "single" as const,
    method: "PUT" as const,
    url: "https://uploads.example.test/opaque-upload-grant",
    headers: { "content-type": "image/jpeg" },
    expiresAt: "2026-09-03T00:00:00.000Z",
  },
};

const completedReplacement = {
  replacementId: "replacement-1",
  imageId: "image-1",
  chapterId: "chapter-1",
  status: "uploaded",
};

function imageFile(type = "image/jpeg", name = "replacement.jpg") {
  return new File(["replacement-bytes"], name, { type });
}

function jsonResponse(value: unknown, status = 200) {
  return new Response(JSON.stringify(value), {
    status,
    headers: { "content-type": "application/json" },
  });
}

class FakeXmlHttpRequest {
  static instances: FakeXmlHttpRequest[] = [];
  static responseStatus = 200;

  readonly upload = { addEventListener: vi.fn() };
  readonly open = vi.fn();
  readonly setRequestHeader = vi.fn();
  readonly send = vi.fn((body: unknown) => {
    this.body = body;
    this.listeners.load?.();
  });
  status = FakeXmlHttpRequest.responseStatus;
  body: unknown;
  private readonly listeners: Record<string, (() => void) | undefined> = {};

  constructor() {
    FakeXmlHttpRequest.instances.push(this);
  }

  addEventListener = vi.fn((event: string, listener: () => void) => {
    this.listeners[event] = listener;
  });
}

afterEach(() => {
  vi.unstubAllGlobals();
  FakeXmlHttpRequest.instances = [];
  FakeXmlHttpRequest.responseStatus = 200;
});

describe("image replacement web client", () => {
  it("sends only the supported prepare metadata", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(jsonResponse(preparedReplacement, 201));
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      prepareImageReplacement({
        chapterId: "chapter-1",
        imageId: "image-1",
        file: imageFile("image/jpeg", "next.jpg"),
      }),
    ).resolves.toEqual(preparedReplacement);

    const [url, options] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe(
      "/api/chapters/chapter-1/images/image-1/replacement-session",
    );
    expect(options.method).toBe("POST");
    expect(JSON.parse(String(options.body))).toEqual({
      filename: "next.jpg",
      contentType: "image/jpeg",
      sizeBytes: imageFile("image/jpeg", "next.jpg").size,
    });
    expect(JSON.parse(String(options.body))).not.toHaveProperty("storageKey");
    expect(JSON.parse(String(options.body))).not.toHaveProperty("version");
    expect(JSON.parse(String(options.body))).not.toHaveProperty("userId");
  });

  it("queues durable completion with only the replacement id in its path", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(jsonResponse(completedReplacement));
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      completeImageReplacement({
        chapterId: "chapter-1",
        imageId: "image-1",
        replacementId: "replacement-1",
      }),
    ).resolves.toEqual(completedReplacement);

    const [url, options] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe(
      "/api/chapters/chapter-1/images/image-1/replacements/replacement-1/complete",
    );
    expect(options).toMatchObject({ method: "POST", credentials: "include" });
    expect(options).not.toHaveProperty("body");
  });

  it("orchestrates prepare, direct PUT, and durable queue acceptance in order", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse(preparedReplacement, 201))
      .mockResolvedValueOnce(jsonResponse(completedReplacement));
    vi.stubGlobal("fetch", fetchMock);
    vi.stubGlobal("XMLHttpRequest", FakeXmlHttpRequest);
    const phases: string[] = [];
    const file = imageFile();

    await expect(
      replaceChapterImage({
        chapterId: "chapter-1",
        imageId: "image-1",
        file,
        onPhase: (phase) => phases.push(phase),
      }),
    ).resolves.toEqual(completedReplacement);

    expect(phases).toEqual(["preparing", "uploading", "completing"]);
    expect(fetchMock.mock.calls.map(([url]) => url)).toEqual([
      "/api/chapters/chapter-1/images/image-1/replacement-session",
      "/api/chapters/chapter-1/images/image-1/replacements/replacement-1/complete",
    ]);
    expect(FakeXmlHttpRequest.instances).toHaveLength(1);
    const request = FakeXmlHttpRequest.instances[0];
    if (request === undefined)
      throw new Error("Expected one direct upload request.");
    expect(request.open).toHaveBeenCalledWith(
      "PUT",
      preparedReplacement.upload.url,
    );
    expect(request.setRequestHeader).toHaveBeenCalledWith(
      "content-type",
      "image/jpeg",
    );
    expect(request.send).toHaveBeenCalledWith(file);
  });

  it("does not complete when the browser PUT fails", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(jsonResponse(preparedReplacement, 201));
    vi.stubGlobal("fetch", fetchMock);
    FakeXmlHttpRequest.responseStatus = 500;
    vi.stubGlobal("XMLHttpRequest", FakeXmlHttpRequest);

    await expect(
      replaceChapterImage({
        chapterId: "chapter-1",
        imageId: "image-1",
        file: imageFile(),
      }),
    ).rejects.toThrow();

    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("does not upload or complete when preparation fails", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(jsonResponse({ error: "invalid" }, 422));
    vi.stubGlobal("fetch", fetchMock);
    vi.stubGlobal("XMLHttpRequest", FakeXmlHttpRequest);

    await expect(
      replaceChapterImage({
        chapterId: "chapter-1",
        imageId: "image-1",
        file: imageFile(),
      }),
    ).rejects.toThrow();

    expect(FakeXmlHttpRequest.instances).toHaveLength(0);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("surfaces completion failure without a second upload", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse(preparedReplacement, 201))
      .mockResolvedValueOnce(jsonResponse({ error: "conflict" }, 409));
    vi.stubGlobal("fetch", fetchMock);
    vi.stubGlobal("XMLHttpRequest", FakeXmlHttpRequest);

    await expect(
      replaceChapterImage({
        chapterId: "chapter-1",
        imageId: "image-1",
        file: imageFile(),
      }),
    ).rejects.toThrow();

    expect(FakeXmlHttpRequest.instances).toHaveLength(1);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it.each(["image/jpeg", "image/png", "image/webp", "image/gif"])(
    "accepts the current backend-supported MIME %s",
    (contentType) => {
      expect(
        validateImageReplacementFile(imageFile(contentType)),
      ).toBeInstanceOf(File);
    },
  );

  it.each([
    "application/zip",
    "application/x-zip-compressed",
    "image/avif",
    "text/plain",
    "",
  ])("rejects unsupported replacement MIME %s", (contentType) => {
    expect(() => validateImageReplacementFile(imageFile(contentType))).toThrow(
      ImageReplacementFileValidationError,
    );
  });

  it("accepts exactly one non-empty image file", () => {
    expect(() => selectSingleImageReplacementFile([])).toThrow(
      ImageReplacementFileValidationError,
    );
    expect(() =>
      selectSingleImageReplacementFile([imageFile(), imageFile("image/png")]),
    ).toThrow(ImageReplacementFileValidationError);
    expect(() =>
      validateImageReplacementFile(
        new File([], "empty.jpg", { type: "image/jpeg" }),
      ),
    ).toThrow(ImageReplacementFileValidationError);
  });
});
