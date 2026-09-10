import { describe, expect, it, vi } from "vitest";
import { createGuildRoleVerifierServer } from "./guild-role-verifier.server.js";

const guildId = "12345678901234567";
const existingRoleId = "22345678901234567";
const missingRoleId = "32345678901234567";

function setup() {
  const roles = new Map([[existingRoleId, { name: "Issuer", position: 3 }]]);
  const client = {
    guilds: {
      cache: new Map([
        [guildId, { roles: { fetch: vi.fn().mockResolvedValue(roles) } }],
      ]),
    },
  } as never;
  const server = createGuildRoleVerifierServer({
    client,
    expectedToken: "internal-token",
    guildId,
    logger: { info: vi.fn(), warn: vi.fn() } as never,
  });
  return { server };
}

describe("guild role verifier internal endpoint", () => {
  it("verifies only roles in the configured guild with M2M authentication", async () => {
    const { server } = setup();
    const port = await server.start("127.0.0.1", 0);
    try {
      const response = await fetch(
        `http://127.0.0.1:${port}/internal/discord/guild-roles/verify`,
        {
          method: "POST",
          headers: {
            authorization: "Bearer internal-token",
            "content-type": "application/json",
          },
          body: JSON.stringify({
            guildId,
            roleIds: [existingRoleId, missingRoleId],
          }),
        },
      );
      expect(response.status).toBe(200);
      await expect(response.json()).resolves.toEqual({
        guildId,
        roles: [
          { roleId: existingRoleId, exists: true, name: "Issuer", position: 3 },
          { roleId: missingRoleId, exists: false },
        ],
      });
    } finally {
      await server.stop();
    }
  });

  it("rejects invalid M2M, arbitrary guilds, duplicate and invalid role IDs", async () => {
    const { server } = setup();
    const port = await server.start("127.0.0.1", 0);
    const request = (token: string, body: unknown) =>
      fetch(`http://127.0.0.1:${port}/internal/discord/guild-roles/verify`, {
        method: "POST",
        headers: {
          authorization: `Bearer ${token}`,
          "content-type": "application/json",
        },
        body: JSON.stringify(body),
      });
    try {
      await expect(
        request("wrong", { guildId, roleIds: [] }),
      ).resolves.toMatchObject({ status: 401 });
      await expect(
        request("internal-token", {
          guildId: "42345678901234567",
          roleIds: [],
        }),
      ).resolves.toMatchObject({ status: 403 });
      await expect(
        request("internal-token", {
          guildId,
          roleIds: [existingRoleId, existingRoleId],
        }),
      ).resolves.toMatchObject({ status: 400 });
      await expect(
        request("internal-token", { guildId, roleIds: ["invalid"] }),
      ).resolves.toMatchObject({ status: 400 });
    } finally {
      await server.stop();
    }
  });
});
