import { timingSafeEqual } from "node:crypto";
import { createServer, type Server } from "node:http";
import type { Client, GuildBasedChannel } from "discord.js";
import type { Logger } from "pino";
import {
  canViewSeriesChannel,
  evaluateSeriesChannelEligibility,
  type SeriesChannelEligibility,
} from "./series-channel-eligibility.policy.js";

const snowflake = /^\d{17,20}$/;
const maxRoleIds = 100;
const maxBodyBytes = 32 * 1024;

type VerifyRequest = { guildId: string; roleIds: string[] };
type ValidateSeriesChannelRequest = { channelId: string };

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

function validSeriesChannelRequest(
  value: unknown,
): value is ValidateSeriesChannelRequest {
  return (
    !!value &&
    typeof value === "object" &&
    "channelId" in value &&
    typeof value.channelId === "string" &&
    snowflake.test(value.channelId)
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

function toSeriesChannelCandidate(
  channel: GuildBasedChannel,
  botUser: Client["user"],
) {
  return {
    id: channel.id,
    guildId: channel.guildId,
    name: channel.name,
    type: channel.type,
    viewable: canViewSeriesChannel(
      botUser ? channel.permissionsFor(botUser) : undefined,
    ),
  };
}

function isUnknownDiscordChannel(error: unknown) {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    error.code === 10003
  );
}

export function createGuildRoleVerifierServer(input: {
  client: Pick<Client, "guilds" | "channels" | "user">;
  expectedToken: string;
  guildId: string;
  controlChannelId: string;
  logger: Logger;
}) {
  let server: Server | undefined;

  const handler = async (
    request: import("node:http").IncomingMessage,
    response: import("node:http").ServerResponse,
  ) => {
    if (
      !hasInternalToken(
        bearer(request.headers.authorization),
        input.expectedToken,
      )
    ) {
      send(response, 401, { code: "internal-authentication-required" });
      return;
    }
    const pathname = request.url?.split("?", 1)[0];
    if (
      request.method === "GET" &&
      pathname === "/internal/discord/series-channels"
    ) {
      const guild = input.client.guilds.cache.get(input.guildId);
      if (!guild) {
        send(response, 503, { code: "discord-guild-unavailable" });
        return;
      }
      try {
        const channels = await guild.channels.fetch();
        const items = [...channels.values()]
          .filter((channel) => channel !== null)
          .map((channel) =>
            evaluateSeriesChannelEligibility({
              channel: toSeriesChannelCandidate(channel, input.client.user),
              guildId: input.guildId,
              controlChannelId: input.controlChannelId,
            }),
          )
          .filter(
            (
              result,
            ): result is Extract<SeriesChannelEligibility, { valid: true }> =>
              result.valid,
          )
          .map((result) => result.channel)
          .sort((left, right) => left.name.localeCompare(right.name));
        send(response, 200, { items });
      } catch (error) {
        input.logger.warn(
          { err: error, guildId: input.guildId },
          "discord_bot.series_channels.list.failed",
        );
        send(response, 503, { code: "discord-series-channels-unavailable" });
      }
      return;
    }
    if (
      request.method === "POST" &&
      pathname === "/internal/discord/series-channels/validate"
    ) {
      let body: unknown;
      try {
        body = await readJson(request);
      } catch {
        send(response, 400, { code: "validation-failed" });
        return;
      }
      if (!validSeriesChannelRequest(body)) {
        send(response, 400, { code: "validation-failed" });
        return;
      }
      const guild = input.client.guilds.cache.get(input.guildId);
      if (!guild) {
        send(response, 503, { code: "discord-guild-unavailable" });
        return;
      }
      try {
        const resolved = await input.client.channels.fetch(body.channelId);
        const result = evaluateSeriesChannelEligibility({
          channel:
            resolved && "guildId" in resolved && "name" in resolved
              ? toSeriesChannelCandidate(resolved, input.client.user)
              : null,
          guildId: input.guildId,
          controlChannelId: input.controlChannelId,
        });
        send(response, 200, result);
      } catch (error) {
        if (isUnknownDiscordChannel(error)) {
          send(response, 200, { valid: false, reason: "not_found" });
          return;
        }
        input.logger.warn(
          { err: error, channelId: body.channelId },
          "discord_bot.series_channels.validate.failed",
        );
        send(response, 503, { code: "discord-series-channels-unavailable" });
      }
      return;
    }
    if (
      request.method !== "POST" ||
      pathname !== "/internal/discord/guild-roles/verify"
    ) {
      send(response, 404, { code: "not-found" });
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
