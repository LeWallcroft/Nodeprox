import { createHash, timingSafeEqual } from "node:crypto";
import { createServer, type Server } from "node:http";
import { EmbedBuilder, type Client, type GuildBasedChannel } from "discord.js";
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
type SeriesGrantNotificationRequest = {
  sourceEventId: string;
  reference: string | null;
};

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

function validGrantNotification(
  value: unknown,
): value is SeriesGrantNotificationRequest {
  if (!value || typeof value !== "object") return false;
  const input = value as Record<string, unknown>;
  return (
    typeof input.sourceEventId === "string" &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
      input.sourceEventId,
    ) &&
    (input.reference === null ||
      (typeof input.reference === "string" && input.reference.length <= 240))
  );
}

export function notificationNonce(sourceEventId: string): string {
  return createHash("sha256")
    .update(sourceEventId)
    .digest("base64url")
    .slice(0, 25);
}

function discordErrorCode(error: unknown): number | null {
  if (!error || typeof error !== "object" || !("code" in error)) return null;
  return typeof error.code === "number" ? error.code : null;
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

export function createDiscordInternalServer(input: {
  client: Pick<Client, "guilds" | "channels" | "users" | "user">;
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
    const profileMatch = /^\/internal\/discord\/users\/([^/]+)\/profile$/.exec(
      pathname ?? "",
    );
    if (request.method === "GET" && profileMatch) {
      const profileDiscordId = profileMatch[1];
      if (!profileDiscordId || !snowflake.test(profileDiscordId)) {
        send(response, 400, { code: "validation-failed" });
        return;
      }
      try {
        const user = await input.client.users.fetch(profileDiscordId);
        send(response, 200, {
          id: user.id,
          username: user.username,
          avatarUrl: user.displayAvatarURL({ extension: "webp", size: 128 }),
        });
      } catch (error) {
        if (discordErrorCode(error) === 10013) {
          send(response, 404, { code: "discord-user-not-found" });
          return;
        }
        input.logger.warn(
          { err: error },
          "discord_bot.user_profile.fetch.failed",
        );
        send(response, 503, { code: "discord-user-profile-unavailable" });
      }
      return;
    }
    const grantNotificationMatch =
      /^\/internal\/discord\/users\/([^/]+)\/notifications\/series-grant$/.exec(
        pathname ?? "",
      );
    if (request.method === "POST" && grantNotificationMatch) {
      const grantDiscordId = grantNotificationMatch[1];
      if (!grantDiscordId || !snowflake.test(grantDiscordId)) {
        send(response, 400, { code: "validation-failed" });
        return;
      }
      let body: unknown;
      try {
        body = await readJson(request);
      } catch {
        send(response, 400, { code: "validation-failed" });
        return;
      }
      if (!validGrantNotification(body)) {
        send(response, 400, { code: "validation-failed" });
        return;
      }
      try {
        const user = await input.client.users.fetch(grantDiscordId);
        const description = [
          "Tienes una nueva autorización para crear una Serie en NodeProx.",
          ...(body.reference ? [`Referencia: ${body.reference}`] : []),
        ].join("\n");
        const message = await user.send({
          embeds: [
            new EmbedBuilder()
              .setTitle("🎟️ Nueva autorización disponible")
              .setDescription(description),
          ],
          nonce: notificationNonce(body.sourceEventId),
          enforceNonce: true,
        });
        send(response, 200, { status: "sent", messageId: message.id });
      } catch (error) {
        const code = discordErrorCode(error);
        if (code === 50007) {
          send(response, 200, { status: "skipped", reason: "dm-unavailable" });
          return;
        }
        if (code === 10013) {
          send(response, 200, {
            status: "skipped",
            reason: "user-unavailable",
          });
          return;
        }
        input.logger.warn({ err: error }, "discord_bot.grant_dm.send.failed");
        send(response, 503, { code: "discord-grant-dm-unavailable" });
      }
      return;
    }
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
