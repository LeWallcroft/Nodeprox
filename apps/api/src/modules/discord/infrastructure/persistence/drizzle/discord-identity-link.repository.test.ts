import { describe, expect, it, vi } from "vitest";
import { DrizzleDiscordIdentityLinkRepository } from "./discord-identity-link.repository.js";

function transactionWithUpdateFailure(error: unknown) {
  const returning = vi.fn().mockRejectedValue(error);
  const where = vi.fn().mockReturnValue({ returning });
  const set = vi.fn().mockReturnValue({ where });
  const update = vi.fn().mockReturnValue({ set });
  return { tx: { update } as never, update, set, where, returning };
}

describe("DrizzleDiscordIdentityLinkRepository", () => {
  const repository = new DrizzleDiscordIdentityLinkRepository();
  const input = {
    tx: undefined as never,
    userId: "user-1",
    discordId: "discord-1",
    discordUsername: "user",
    discordAvatarUrl: null,
  };

  it("maps only the known Discord identity unique constraint", async () => {
    const db = transactionWithUpdateFailure({
      code: "23505",
      constraint: "users_discord_id_unique",
    });
    await expect(
      repository.updateDiscordIdentity({ ...input, tx: db.tx }),
    ).resolves.toBe("discord-id-already-linked");
  });

  it("propagates unknown unique constraints", async () => {
    const failure = { code: "23505", constraint: "unrelated_unique" };
    const db = transactionWithUpdateFailure(failure);
    await expect(
      repository.updateDiscordIdentity({ ...input, tx: db.tx }),
    ).rejects.toBe(failure);
  });
});
