import { describe, expect, it, vi } from "vitest";
import { IdentityService } from "./identity.service.js";

describe("IdentityService admin lookup", () => {
  it("returns a bounded cursor page after authorization", async () => {
    const users = {
      lookup: vi.fn().mockResolvedValue([
        { id: "1", email: "a@example.com" },
        { id: "2", email: "b@example.com" },
      ]),
    };
    const authorization = {
      authorize: vi.fn().mockResolvedValue({ allowed: true }),
    };
    const service = new IdentityService(
      users as never,
      {} as never,
      authorization as never,
    );
    const result = await service.lookup(
      { userId: "admin", sessionId: "session" },
      { search: "example", limit: 1 },
    );
    expect(users.lookup).toHaveBeenCalledWith(
      expect.objectContaining({ search: "example", limit: 1 }),
    );
    expect(result.items).toEqual([
      { id: "1", displayName: "a@example.com", email: "a@example.com" },
    ]);
    expect(result.nextCursor).toEqual(expect.any(String));
  });

  it("allows a grant issuer to use the limited lookup without user-management access", async () => {
    const users = {
      lookup: vi.fn().mockResolvedValue([]),
    };
    const authorization = {
      authorize: vi
        .fn()
        .mockResolvedValueOnce({ allowed: false })
        .mockResolvedValueOnce({ allowed: true }),
    };
    const service = new IdentityService(
      users as never,
      {} as never,
      authorization as never,
    );

    await expect(
      service.lookup({ userId: "gestor", sessionId: "session" }, { limit: 20 }),
    ).resolves.toMatchObject({ items: [] });
    expect(authorization.authorize).toHaveBeenCalledTimes(2);
  });
});
