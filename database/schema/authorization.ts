import { sql } from "drizzle-orm";
import {
  boolean,
  index,
  inet,
  jsonb,
  numeric,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { users } from "./authentication.js";

export const systemConfig = pgTable("system_config", {
  key: text("key").primaryKey(),
  value: jsonb("value").notNull(),
  updatedBy: uuid("updated_by").references(() => users.id),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export const auditResultEnum = pgEnum("audit_result", [
  "success",
  "rejected",
  "failed",
]);

export const auditLogs = pgTable(
  "audit_log",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    actorId: uuid("actor_id").references(() => users.id),
    action: text("action").notNull(),
    resourceType: text("resource_type").notNull(),
    resourceId: uuid("resource_id"),
    // Historical events predate the outcome contract and intentionally remain null.
    result: auditResultEnum("result").default("success"),
    reasonCode: text("reason_code"),
    requestId: text("request_id"),
    metadata: jsonb("metadata").notNull().default(sql`'{}'::jsonb`),
    ipAddress: inet("ip_address"),
    requestMethod: text("request_method"),
    requestPath: text("request_path"),
    durationMs: numeric("duration_ms", { mode: "number" }),
    clientBrowser: text("client_browser"),
    clientOperatingSystem: text("client_operating_system"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    index("audit_log_actor_created_at_idx").on(table.actorId, table.createdAt),
    index("audit_log_created_at_id_idx").on(table.createdAt, table.id),
    index("audit_log_result_created_at_idx").on(table.result, table.createdAt),
    index("audit_log_request_id_created_at_idx").on(
      table.requestId,
      table.createdAt,
    ),
    index("audit_log_resource_idx").on(table.resourceType, table.resourceId),
    index("audit_log_request_id_idx").on(table.requestId),
  ],
);

export const discordIntegrations = pgTable(
  "discord_integrations",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    guildId: text("guild_id").notNull(),
    controlChannelId: text("control_channel_id").notNull(),
    enabled: boolean("enabled").notNull().default(true),
    updatedBy: uuid("updated_by").references(() => users.id),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    uniqueIndex("discord_integrations_guild_id_unique").on(table.guildId),
  ],
);

export const discordAuthorizedRoles = pgTable(
  "discord_authorized_roles",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    integrationId: uuid("integration_id")
      .notNull()
      .references(() => discordIntegrations.id, { onDelete: "cascade" }),
    roleId: text("role_id").notNull(),
    canIssueSeriesGrants: boolean("can_issue_series_grants")
      .notNull()
      .default(false),
    canInvalidateSeriesGrants: boolean("can_invalidate_series_grants")
      .notNull()
      .default(false),
    canConfigureBot: boolean("can_configure_bot").notNull().default(false),
    createdBy: uuid("created_by").references(() => users.id),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    uniqueIndex("discord_authorized_roles_integration_role_unique").on(
      table.integrationId,
      table.roleId,
    ),
  ],
);

export const discordInteractions = pgTable("discord_interactions", {
  interactionId: text("interaction_id").primaryKey(),
  interactionType: text("interaction_type").notNull(),
  actorDiscordId: text("actor_discord_id").notNull(),
  guildId: text("guild_id").notNull(),
  channelId: text("channel_id").notNull(),
  correlationId: uuid("correlation_id").notNull().defaultRandom(),
  result: text("result").notNull(),
  processedAt: timestamp("processed_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});
