import { describe, expect, it, vi } from "vitest";
import { SessionService } from "./session.service.js";

describe("SessionService.resolve", () => {
  it("projects the linked Discord avatar in the safe session user view", async () => {
    const now = new Date();
    const user = {
      id: "user-1",
      email: "reader@example.com",
      status: "active",
      discordUsername: "reader",
      discordId: "12345678901234567",
      displayName: "Reader Name",
      avatarUrl:
        "https://cdn.discordapp.com/avatars/12345678901234567/hash.webp",
      passwordHash: "must-not-be-projected",
      createdAt: now,
      updatedAt: now,
    };
    const sessions = {
      findValidByTokenHash: vi.fn().mockResolvedValue({
        session: {
          id: "session-1",
          userId: user.id,
          tokenHash: "hash",
          createdAt: now,
          expiresAt: new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000),
          absoluteExpiresAt: new Date(now.getTime() + 90 * 24 * 60 * 60 * 1000),
          revokedAt: null,
          lastSeenAt: now,
          ip: null,
          userAgent: null,
          metadata: null,
        },
        user,
      }),
    };
    const service = new SessionService(
      {} as never,
      sessions as never,
      {} as never,
    );

    const result = await service.resolve("session-token");

    expect(result?.user).toMatchObject({
      id: user.id,
      email: user.email,
      discordUsername: user.discordUsername,
      displayName: user.displayName,
      avatarUrl: user.avatarUrl,
      discordLinked: true,
    });
    expect(result?.user).not.toHaveProperty("discordId");
    expect(result?.user).not.toHaveProperty("passwordHash");
  });
});
