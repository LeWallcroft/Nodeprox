import { afterEach, describe, expect, it, vi } from "vitest";
import { runBrowserUploadProbe } from "./api";

afterEach(() => vi.unstubAllGlobals());

describe("StorageProfile browser CORS probe", () => {
  it("uploads directly to the signed B2 URL before completing via same-origin API", async () => {
    const requests: string[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string, options?: RequestInit) => {
        requests.push(`${options?.method ?? "GET"} ${url}`);
        if (url.endsWith("/browser-probe/start"))
          return new Response(
            JSON.stringify({
              probeId: "probe",
              body: "test",
              contentType: "text/plain",
              grant: {
                mode: "single",
                method: "PUT",
                url: "https://s3.example.test/signed",
                headers: { "Content-Type": "text/plain" },
              },
            }),
            { status: 200 },
          );
        if (url === "https://s3.example.test/signed") {
          expect(options?.body).toBe("test");
          return new Response(null, { status: 200 });
        }
        if (url.endsWith("/browser-probe/complete")) {
          expect(JSON.parse(String(options?.body))).toEqual({
            probeId: "probe",
            outcome: "uploaded",
          });
        }
        return new Response(JSON.stringify({ profileId: "profile" }), {
          status: 200,
        });
      }),
    );
    await runBrowserUploadProbe("profile");
    expect(requests).toEqual([
      "POST /api/admin/storage/profiles/profile/browser-probe/start",
      "PUT https://s3.example.test/signed",
      "POST /api/admin/storage/profiles/profile/browser-probe/complete",
    ]);
  });

  it("reports a failed direct PUT to the API so the probe can be cleaned", async () => {
    const requests: Array<{ url: string; options?: RequestInit }> = [];
    const fetch = vi.fn(async (url: string, options?: RequestInit) => {
      requests.push({ url, ...(options ? { options } : {}) });
      if (url.endsWith("/browser-probe/start"))
        return new Response(
          JSON.stringify({
            probeId: "probe",
            body: "test",
            grant: {
              mode: "single",
              method: "PUT",
              url: "https://s3.example.test/signed",
              headers: {},
            },
          }),
          { status: 200 },
        );
      if (url === "https://s3.example.test/signed")
        throw new TypeError("Failed to fetch");
      return new Response(JSON.stringify({ profileId: "profile" }), {
        status: 200,
      });
    });
    vi.stubGlobal("fetch", fetch);
    await expect(runBrowserUploadProbe("profile")).rejects.toThrow("CORS");
    expect(requests.map(({ url }) => url)).toEqual([
      "/api/admin/storage/profiles/profile/browser-probe/start",
      "https://s3.example.test/signed",
      "/api/admin/storage/profiles/profile/browser-probe/complete",
    ]);
    expect(JSON.parse(String(requests[2]?.options?.body))).toEqual({
      probeId: "probe",
      outcome: "client_failed",
    });
  });
});
