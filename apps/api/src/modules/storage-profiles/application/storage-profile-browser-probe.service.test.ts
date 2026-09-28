import { createHash } from "node:crypto";
import { Readable } from "node:stream";
import type { ManagedStorageAdministrationResolver } from "@nodeprox/storage/profile-execution";
import { describe, expect, it, vi } from "vitest";
import type { StorageProfileReadinessRepository } from "./ports/storage-profile-readiness.ports.js";
import { StorageProfileBrowserProbeService } from "./storage-profile-browser-probe.service.js";

function fixture(enabled = true) {
  type Session = {
    id: string;
    storageKey: string;
    expectedSha256: string;
    expectedSizeBytes: number;
    contentType: string;
    expiresAt: Date;
    status: "pending" | "checking" | "completed" | "failed" | "expired";
  };
  const state: {
    sessions: Map<string, Session>;
    body: Buffer | null;
  } = { sessions: new Map(), body: null };
  const upsertCheck = vi.fn(async () => {});
  const repo = {
    findById: vi.fn(async () => ({ source: "managed" })),
    listChecks: vi.fn(async () =>
      ["b2_credentials", "b2_bucket", "b2_cors"].map((checkType) => ({
        checkType,
        status: "verified",
      })),
    ),
    createProbeSession: vi.fn(async (probe: Omit<Session, "status">) => {
      state.sessions.set(probe.id, { ...probe, status: "pending" });
    }),
    claimProbeSession: vi.fn(async (_profileId: string, probeId: string) => {
      const session = state.sessions.get(probeId);
      if (!session) return null;
      if (session.status === "pending" && session.expiresAt > new Date()) {
        session.status = "checking";
        return {
          state: "claimed" as const,
          storageKey: session.storageKey,
          expectedSha256: session.expectedSha256,
          expectedSizeBytes: session.expectedSizeBytes,
          contentType: session.contentType,
        };
      }
      return { state: session.status, storageKey: session.storageKey };
    }),
    expireProbeSessions: vi.fn(async (profileId: string) => {
      void profileId;
      const expired: Array<{ id: string; storageKey: string }> = [];
      for (const session of state.sessions.values())
        if (session.status === "pending" && session.expiresAt <= new Date()) {
          session.status = "expired";
          expired.push({ id: session.id, storageKey: session.storageKey });
        }
      return expired;
    }),
    completeProbeSession: vi.fn(
      async (probeId: string, status: "completed" | "failed" | "expired") => {
        const session = state.sessions.get(probeId);
        if (session?.status === "checking" || session?.status === "expired")
          session.status = status;
      },
    ),
    upsertCheck,
    recomputeReadiness: vi.fn(async () => {}),
  } as unknown as StorageProfileReadinessRepository;
  const storage = {
    head: vi.fn(async () =>
      state.body ? { sizeBytes: state.body.length } : null,
    ),
    get: vi.fn(async () => Readable.from(state.body ?? Buffer.alloc(0))),
    delete: vi.fn(async () => {}),
  };
  const transfer = {
    initiate: vi.fn(async () => ({
      mode: "single" as const,
      method: "PUT" as const,
      url: "https://s3.example.test/signed",
      headers: { "Content-Type": "text/plain" },
      expiresAt: new Date(Date.now() + 300_000).toISOString(),
    })),
  };
  const execution = {
    administrationStorageFor: vi.fn(async () => storage),
    administrationUploadTransferFor: vi.fn(async () => transfer),
  } as unknown as ManagedStorageAdministrationResolver;
  return {
    state,
    repo,
    upsertCheck,
    storage,
    transfer,
    service: new StorageProfileBrowserProbeService(repo, execution, enabled),
  };
}

describe("browser upload probe", () => {
  it("persists only expected hash and verifies a browser-uploaded object", async () => {
    const f = fixture();
    const started = await f.service.start("profile-id");
    expect(started.grant.method).toBe("PUT");
    const session = f.state.sessions.get(started.probeId);
    expect(JSON.stringify(session)).not.toContain(started.grant.url);
    f.state.body = Buffer.from(started.body);
    expect(createHash("sha256").update(f.state.body).digest("hex")).toBe(
      session?.expectedSha256,
    );
    await f.service.complete("profile-id", started.probeId, "uploaded");
    expect(f.storage.delete).toHaveBeenCalledOnce();
    expect(session?.status).toBe("completed");
    expect(f.repo.upsertCheck).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "b2_browser_upload",
        status: "verified",
      }),
    );
  });
  it("keeps browser CORS failure unverified and prevents provider access when disabled", async () => {
    const disabled = fixture(false);
    await expect(disabled.service.start("profile-id")).rejects.toThrow(
      "storage-managed-operations-disabled",
    );
    expect(disabled.transfer.initiate).not.toHaveBeenCalled();
    const f = fixture();
    const started = await f.service.start("profile-id");
    f.state.body = Buffer.from("unexpected");
    await expect(
      f.service.complete("profile-id", started.probeId, "uploaded"),
    ).rejects.toThrow("B2_BROWSER_UPLOAD_PROBE_FAILED");
    expect(f.repo.upsertCheck).toHaveBeenCalledWith(
      expect.objectContaining({ type: "b2_browser_upload", status: "failed" }),
    );
    expect(f.storage.delete).toHaveBeenCalledOnce();
  });
  it("does not mark the profile ready if probe cleanup fails", async () => {
    const f = fixture();
    const started = await f.service.start("profile-id");
    f.state.body = Buffer.from(started.body);
    f.storage.delete.mockRejectedValueOnce(new Error("provider unavailable"));
    await expect(
      f.service.complete("profile-id", started.probeId, "uploaded"),
    ).rejects.toThrow("B2_BROWSER_UPLOAD_PROBE_FAILED");
    expect(f.repo.upsertCheck).not.toHaveBeenCalledWith(
      expect.objectContaining({
        type: "b2_browser_upload",
        status: "verified",
      }),
    );
    expect(f.repo.upsertCheck).toHaveBeenCalledWith(
      expect.objectContaining({ type: "b2_browser_upload", status: "failed" }),
    );
    expect(f.state.sessions.get(started.probeId)?.status).toBe("failed");
  });

  it("records client PUT failure and best-effort cleans the object", async () => {
    const f = fixture();
    const started = await f.service.start("profile-id");
    expect(
      await f.service.complete("profile-id", started.probeId, "client_failed"),
    ).toBe("failed");
    expect(f.storage.delete).toHaveBeenCalledOnce();
    expect(f.state.sessions.get(started.probeId)?.status).toBe("failed");
    expect(f.repo.upsertCheck).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "b2_browser_upload",
        status: "failed",
        errorCode: "B2_BROWSER_UPLOAD_PROBE_FAILED",
      }),
    );
  });

  it("expires abandoned sessions and cleans their objects on the next start", async () => {
    const f = fixture();
    const abandoned = await f.service.start("profile-id");
    const session = f.state.sessions.get(abandoned.probeId);
    if (!session) throw new Error("probe-session-missing");
    session.expiresAt = new Date(Date.now() - 1);
    const next = await f.service.start("profile-id");
    expect(f.state.sessions.get(abandoned.probeId)?.status).toBe("expired");
    expect(f.storage.delete).toHaveBeenCalledWith(session.storageKey);
    expect(f.repo.upsertCheck).toHaveBeenCalledWith(
      expect.objectContaining({
        status: "failed",
        errorCode: "B2_BROWSER_UPLOAD_PROBE_EXPIRED",
      }),
    );
    expect(f.state.sessions.get(next.probeId)?.status).toBe("pending");
  });

  it("returns the same successful result on repeated completion without side effects", async () => {
    const f = fixture();
    const started = await f.service.start("profile-id");
    f.state.body = Buffer.from(started.body);
    await expect(
      f.service.complete("profile-id", started.probeId, "uploaded"),
    ).resolves.toBe("verified");
    const deletes = f.storage.delete.mock.calls.length;
    const checks = f.upsertCheck.mock.calls.length;
    await expect(
      f.service.complete("profile-id", started.probeId, "uploaded"),
    ).resolves.toBe("verified");
    expect(f.storage.delete).toHaveBeenCalledTimes(deletes);
    expect(f.upsertCheck).toHaveBeenCalledTimes(checks);
  });
});
