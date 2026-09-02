import { sql } from "drizzle-orm";
import {
  index,
  inet,
  jsonb,
  pgEnum,
  pgTable,
  text,
  timestamp,
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
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    index("audit_log_actor_created_at_idx").on(table.actorId, table.createdAt),
    index("audit_log_resource_idx").on(table.resourceType, table.resourceId),
    index("audit_log_request_id_idx").on(table.requestId),
  ],
);
