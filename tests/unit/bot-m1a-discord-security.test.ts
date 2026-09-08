import { describe, expect, it } from "vitest";
import {
  InMemoryLinkCodeStore,
  matchesInternalToken,
} from "../../apps/api/src/modules/discord/application/discord-gateway.service.js";

describe("BOT-M1A Discord primitives", () => {
  it("uses a single-use link code", async () => {
    const store = new InMemoryLinkCodeStore();
    await store.create("user-1", "code", 600);
    await expect(store.consume("code")).resolves.toBe("user-1");
    await expect(store.consume("code")).resolves.toBeNull();
  });

  it("compares M2M credentials safely without accepting missing or wrong values", () => {
    expect(matchesInternalToken(undefined, "secret")).toBe(false);
    expect(matchesInternalToken("wrong", "secret")).toBe(false);
    expect(matchesInternalToken("secret", "secret")).toBe(true);
  });
});
