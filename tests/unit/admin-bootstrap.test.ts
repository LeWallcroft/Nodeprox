import { describe, expect, it, vi } from "vitest";
import {
  AdminBootstrapService,
  type AdminBootstrapStore,
} from "../../apps/api/src/modules/authorization/application/services/admin-bootstrap.service.js";

describe("admin bootstrap service", () => {
  it("hashes credentials and delegates exactly the configured identity", async () => {
    const store: AdminBootstrapStore = {
      ensureAdmin: vi.fn().mockResolvedValue({
        outcome: "created",
        userId: "admin-id",
      }),
    };
    const hasher = { hash: vi.fn().mockResolvedValue("argon2id-hash") };
    const result = await new AdminBootstrapService(store, hasher).run({
      email: " Admin@Example.com ",
      password: "secret",
    });

    expect(result.outcome).toBe("created");
    expect(hasher.hash).not.toHaveBeenCalled();
    const call = vi.mocked(store.ensureAdmin).mock.calls[0]?.[0];
    expect(call?.email).toBe("admin@example.com");
    await expect(call?.createPasswordHash()).resolves.toBe("argon2id-hash");
    expect(hasher.hash).toHaveBeenCalledWith("secret");
  });

  it("fails closed for missing bootstrap credentials", async () => {
    const store: AdminBootstrapStore = {
      ensureAdmin: vi.fn(),
    };
    const hasher = { hash: vi.fn() };

    await expect(
      new AdminBootstrapService(store, hasher).run({
        email: "",
        password: "",
      }),
    ).rejects.toThrow("credentials are invalid");
    expect(hasher.hash).not.toHaveBeenCalled();
    expect(store.ensureAdmin).not.toHaveBeenCalled();
  });
});
