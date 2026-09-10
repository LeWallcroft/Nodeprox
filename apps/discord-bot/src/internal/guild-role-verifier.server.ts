import { timingSafeEqual } from "node:crypto";
import { createServer, type Server } from "node:http";
import type { Client } from "discord.js";
import type { Logger } from "pino";

const snowflake = /^\d{17,20}$/;
const maxRoleIds = 100;
const maxBodyBytes = 32 * 1024;

type VerifyRequest = { guildId: string; roleIds: string[] };

export type DiscordGuildRoleVerification = {
  guildId: string;
  roles: Array<{
    roleId: string;
    exists: boolean;
    name?: string;
    position?: number;
  }>;
};

function hasInternalToken(provided: string | undefined, expected: string) {
  if (!provided) return false;
  const left = Buffer.from(provided);
  const right = Buffer.from(expected);
  return left.length === right.length && timingSafeEqual(left, right);
}

function bearer(value: string | undefined) {
  return value?.startsWith("Bearer ") ? value.slice(7) : undefined;
}

function validRequest(value: unknown): value is VerifyRequest {
  if (!value || typeof value !== "object") return false;
  const input = value as { guildId?: unknown; roleIds?: unknown };
  return (
    typeof input.guildId === "string" &&
    snowflake.test(input.guildId) &&
    Array.isArray(input.roleIds) &&
    input.roleIds.length <= maxRoleIds &&
    input.roleIds.every(
      (roleId) => typeof roleId === "string" && snowflake.test(roleId),
    ) &&
    new Set(input.roleIds).size === input.roleIds.length
  );
}

function send(
  response: import("node:http").ServerResponse,
  status: number,
  body: unknown,
) {
  response.writeHead(status, { "content-type": "application/json" });
  response.end(JSON.stringify(body));
}

async function readJson(
  request: import("node:http").IncomingMessage,
): Promise<unknown> {
  const parts: Buffer[] = [];
  let size = 0;
  for await (const chunk of request) {
    const part = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    size += part.length;
    if (size > maxBodyBytes) throw new Error("body-too-large");
    parts.push(part);
  }
  return JSON.parse(Buffer.concat(parts).toString("utf8"));
}

export function createGuildRoleVerifierServer(input: {
  client: Pick<Client, "guilds">;
  expectedToken: string;
  guildId: string;
  logger: Logger;
}) {
  let server: Server | undefined;

  const handler = async (
    request: import("node:http").IncomingMessage,
    response: import("node:http").ServerResponse,
  ) => {
    if (
      request.method !== "POST" ||
      request.url !== "/internal/discord/guild-roles/verify"
    ) {
      send(response, 404, { code: "not-found" });
      return;
    }
    if (
      !hasInternalToken(
        bearer(request.headers.authorization),
        input.expectedToken,
      )
    ) {
      send(response, 401, { code: "internal-authentication-required" });
      return;
    }
    let body: unknown;
    try {
      body = await readJson(request);
    } catch {
      send(response, 400, { code: "validation-failed" });
      return;
    }
    if (!validRequest(body)) {
      send(response, 400, { code: "validation-failed" });
      return;
    }
    if (body.guildId !== input.guildId) {
      send(response, 403, { code: "discord-guild-not-allowed" });
      return;
    }
    const guild = input.client.guilds.cache.get(body.guildId);
    if (!guild) {
      send(response, 503, { code: "discord-guild-unavailable" });
      return;
    }
    try {
      const roles = await guild.roles.fetch();
      const result: DiscordGuildRoleVerification = {
        guildId: body.guildId,
        roles: body.roleIds.map((roleId) => {
          const role = roles.get(roleId);
          return role
            ? { roleId, exists: true, name: role.name, position: role.position }
            : { roleId, exists: false };
        }),
      };
      send(response, 200, result);
    } catch (error) {
      input.logger.warn(
        { err: error, guildId: body.guildId, roleCount: body.roleIds.length },
        "discord_bot.guild_roles.verify.failed",
      );
      send(response, 503, { code: "discord-role-verification-unavailable" });
    }
  };

  return {
    async start(host: string, port: number): Promise<number> {
      if (server) {
        const address = server.address();
        return typeof address === "object" && address ? address.port : port;
      }
      server = createServer(
        (request, response) => void handler(request, response),
      );
      await new Promise<void>((resolve, reject) => {
        server?.once("error", reject);
        server?.listen(port, host, () => {
          server?.off("error", reject);
          resolve();
        });
      });
      input.logger.info(
        { host, port },
        "discord_bot.internal_server.listening",
      );
      const address = server.address();
      if (typeof address !== "object" || !address)
        throw new Error("discord-bot-internal-server-address-unavailable");
      return address.port;
    },
    async stop() {
      if (!server) return;
      const active = server;
      server = undefined;
      await new Promise<void>((resolve, reject) =>
        active.close((error) => (error ? reject(error) : resolve())),
      );
    },
  };
}
