import { describe, expect, it } from "vitest";
import {
  digestDiscordLinkCode,
  InMemoryLinkCodeStore,
  matchesInternalToken,
} from "../../apps/api/src/modules/discord/application/discord-gateway.service.js";

describe("BOT-M1A Discord primitives", () => {
  it("keeps one digest-keyed, single-use link challenge per user", async () => {
    const store = new InMemoryLinkCodeStore();
    const firstDigest = digestDiscordLinkCode("first-code");
    const secondDigest = digestDiscordLinkCode("second-code");
    const expiresAt = new Date(Date.now() + 600_000);
    await store.createReplacingPrevious({
      userId: "user-1",
      codeDigest: firstDigest,
      expiresAt,
      ttlSeconds: 600,
    });
    await store.createReplacingPrevious({
      userId: "user-1",
      codeDigest: secondDigest,
      expiresAt,
      ttlSeconds: 600,
    });
    await expect(
      store.claim({ codeDigest: firstDigest, interactionId: "interaction-a" }),
    ).resolves.toEqual({ status: "not_found" });
    await expect(
      store.claim({ codeDigest: secondDigest, interactionId: "interaction-a" }),
    ).resolves.toEqual({ status: "claimed", userId: "user-1" });
    await expect(
      store.claim({ codeDigest: secondDigest, interactionId: "interaction-b" }),
    ).resolves.toEqual({ status: "claimed_by_other" });
    await store.releaseClaim({
      codeDigest: secondDigest,
      interactionId: "interaction-a",
    });
    await expect(
      store.claim({ codeDigest: secondDigest, interactionId: "interaction-b" }),
    ).resolves.toEqual({ status: "claimed", userId: "user-1" });
    const newerDigest = digestDiscordLinkCode("newer-code");
    await store.createReplacingPrevious({
      userId: "user-1",
      codeDigest: newerDigest,
      expiresAt,
      ttlSeconds: 600,
    });
    await store.finalize({
      userId: "user-1",
      codeDigest: secondDigest,
      interactionId: "interaction-b",
    });
    await expect(store.getActiveForUser("user-1")).resolves.toEqual({
      codeDigest: newerDigest,
      expiresAt,
    });
  });

  it("compares M2M credentials safely without accepting missing or wrong values", () => {
    expect(matchesInternalToken(undefined, "secret")).toBe(false);
    expect(matchesInternalToken("wrong", "secret")).toBe(false);
    expect(matchesInternalToken("secret", "secret")).toBe(true);
  });
});
