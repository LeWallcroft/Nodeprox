import Fastify from "fastify";
import { describe, expect, it, vi } from "vitest";
import { registerDiscordProfileEventPlugin } from "./discord-profile-event.plugin.js";

const path = "/internal/discord/users/12345678901234567/profile-changed";

function setup(result: "changed" | "not-linked" = "changed") {
  const app = Fastify();
  const syncLinkedProfileByDiscordId = vi.fn().mockResolvedValue(result);
  registerDiscordProfileEventPlugin(app, {
    service: { syncLinkedProfileByDiscordId } as never,
    internalToken: "internal-token",
  });
  return { app, syncLinkedProfileByDiscordId };
}

describe("Discord profile signal boundary", () => {
  it("requires the bot token and accepts only a valid snowflake and empty body", async () => {
    const { app, syncLinkedProfileByDiscordId } = setup();
    try {
      expect(
        (await app.inject({ method: "POST", url: path, payload: {} }))
          .statusCode,
      ).toBe(401);
      expect(
        (
          await app.inject({
            method: "POST",
            url: path,
            headers: { authorization: "Bearer wrong" },
            payload: {},
          })
        ).statusCode,
      ).toBe(401);
      expect(
        (
          await app.inject({
            method: "POST",
            url: "/internal/discord/users/invalid/profile-changed",
            headers: { authorization: "Bearer internal-token" },
            payload: {},
          })
        ).statusCode,
      ).toBe(422);
      expect(
        (
          await app.inject({
            method: "POST",
            url: path,
            headers: { authorization: "Bearer internal-token" },
            payload: { username: "spoofed" },
          })
        ).statusCode,
      ).toBe(422);
      expect(syncLinkedProfileByDiscordId).not.toHaveBeenCalled();
    } finally {
      await app.close();
    }
  });

  it.each(["changed", "not-linked"] as const)(
    "returns the same safe response for %s",
    async (result) => {
      const { app, syncLinkedProfileByDiscordId } = setup(result);
      try {
        const response = await app.inject({
          method: "POST",
          url: path,
          headers: { authorization: "Bearer internal-token" },
          payload: {},
        });
        expect(response.statusCode).toBe(200);
        expect(response.json()).toEqual({ accepted: true });
        expect(syncLinkedProfileByDiscordId).toHaveBeenCalledWith(
          "12345678901234567",
        );
      } finally {
        await app.close();
      }
    },
  );
});
