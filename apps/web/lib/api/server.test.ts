import { describe, expect, it, vi } from "vitest";
import { apiRequestServer } from "./server";
import { ApiError, ApiUnavailableError } from "./types";

const dependencies = (fetcher: typeof fetch, sleep = vi.fn()) => ({
  fetcher,
  sleep,
  readHeaders: async () => new Headers(),
});

describe("server API boundary", () => {
  it("does not retry a successful bootstrap request", async () => {
    const fetcher = vi
      .fn()
      .mockResolvedValue(
        new Response(JSON.stringify({ ok: true }), { status: 200 }),
      );
    const sleep = vi.fn();
    await expect(
      apiRequestServer(
        "/auth/session",
        { retry: "bootstrap" },
        dependencies(fetcher, sleep),
      ),
    ).resolves.toEqual({ ok: true });
    expect(fetcher).toHaveBeenCalledOnce();
    expect(sleep).not.toHaveBeenCalled();
    expect(fetcher).toHaveBeenCalledWith(
      "http://127.0.0.1:3001/auth/session",
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    );
  });

  it.each([500, 502, 503, 504])("retries bootstrap HTTP %s", async (status) => {
    const fetcher = vi
      .fn()
      .mockResolvedValueOnce(new Response("", { status }))
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ ok: true }), { status: 200 }),
      );
    const sleep = vi.fn().mockResolvedValue(undefined);
    await expect(
      apiRequestServer(
        "/auth/capabilities",
        { retry: "bootstrap" },
        dependencies(fetcher, sleep),
      ),
    ).resolves.toEqual({ ok: true });
    expect(fetcher).toHaveBeenCalledTimes(2);
    expect(sleep).toHaveBeenCalledWith(250);
  });

  it("retries a transport failure and classifies exhaustion safely", async () => {
    const recovered = vi
      .fn()
      .mockRejectedValueOnce(new TypeError("fetch failed"))
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ ok: true }), { status: 200 }),
      );
    const sleep = vi.fn().mockResolvedValue(undefined);
    await expect(
      apiRequestServer(
        "/auth/session",
        { retry: "bootstrap" },
        dependencies(recovered, sleep),
      ),
    ).resolves.toEqual({ ok: true });

    const unavailable = vi
      .fn()
      .mockRejectedValue(new TypeError("fetch failed"));
    await expect(
      apiRequestServer(
        "/auth/session",
        { retry: "bootstrap" },
        dependencies(unavailable, sleep),
      ),
    ).rejects.toBeInstanceOf(ApiUnavailableError);
    expect(unavailable).toHaveBeenCalledTimes(4);
  });

  it("retries a bootstrap timeout without waiting for a real timeout", async () => {
    const fetcher = vi
      .fn()
      .mockRejectedValueOnce(new DOMException("Timed out", "TimeoutError"))
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ ok: true }), { status: 200 }),
      );
    const sleep = vi.fn().mockResolvedValue(undefined);

    await expect(
      apiRequestServer(
        "/auth/session",
        { retry: "bootstrap" },
        dependencies(fetcher, sleep),
      ),
    ).resolves.toEqual({ ok: true });

    expect(fetcher).toHaveBeenCalledTimes(2);
    expect(sleep).toHaveBeenCalledWith(250);
  });

  it.each([401, 403, 404])("fails fast for HTTP %s", async (status) => {
    const fetcher = vi.fn().mockResolvedValue(new Response("", { status }));
    const sleep = vi.fn();
    await expect(
      apiRequestServer(
        "/auth/session",
        { retry: "bootstrap" },
        dependencies(fetcher, sleep),
      ),
    ).rejects.toBeInstanceOf(ApiError);
    expect(fetcher).toHaveBeenCalledOnce();
    expect(sleep).not.toHaveBeenCalled();
  });

  it("never retries a mutation transport failure", async () => {
    const fetcher = vi.fn().mockRejectedValue(new TypeError("fetch failed"));
    const sleep = vi.fn();
    await expect(
      apiRequestServer(
        "/auth/logout",
        { method: "POST" },
        dependencies(fetcher, sleep),
      ),
    ).rejects.toBeInstanceOf(ApiUnavailableError);
    expect(fetcher).toHaveBeenCalledOnce();
    expect(sleep).not.toHaveBeenCalled();
  });
});
