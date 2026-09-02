import { sql } from "drizzle-orm";
import {
  check,
  index,
  numeric,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
  varchar,
} from "drizzle-orm/pg-core";
import { users } from "./authentication.js";
import { series } from "./series.js";

export const chapterStatusEnum = pgEnum("chapter_status", [
  "draft",
  "uploading",
  "uploaded",
  "processing",
  "ready",
  "failed",
  "deleting",
]);

const delegablePermissionValues = [
  "chapters.read",
  "chapters.edit",
  "chapters.replace",
  "images.upload",
  "images.replace",
  "images.reorder",
  "images.delete",
] as const;

export const chapters = pgTable(
  "chapters",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    seriesId: uuid("series_id")
      .notNull()
      .references(() => series.id, { onDelete: "restrict" }),
    chapterNumber: numeric("chapter_number", {
      precision: 10,
      scale: 3,
      mode: "number",
    }).notNull(),
    publicKey: varchar("public_key", { length: 64 }).notNull(),
    title: text("title"),
    status: chapterStatusEnum("status").notNull().default("draft"),
    createdBy: uuid("created_by")
      .notNull()
      .references(() => users.id),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    index("chapters_series_id_idx").on(table.seriesId),
    uniqueIndex("chapters_series_number_unique").on(
      table.seriesId,
      table.chapterNumber,
    ),
    uniqueIndex("chapters_series_public_key_unique").on(
      table.seriesId,
      table.publicKey,
    ),
    check("chapters_number_non_negative", sql`${table.chapterNumber} >= 0`),
    check(
      "chapters_public_key_url_safe",
      sql`${table.publicKey} ~ '^[a-z0-9]+(?:-[a-z0-9]+)*$'`,
    ),
  ],
);

export const chapterPermissions = pgTable(
  "chapter_permissions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    chapterId: uuid("chapter_id")
      .notNull()
      .references(() => chapters.id, { onDelete: "cascade" }),
    helperUserId: uuid("helper_user_id")
      .notNull()
      .references(() => users.id),
    permission: text("permission").notNull(),
    grantedBy: uuid("granted_by")
      .notNull()
      .references(() => users.id),
    grantedAt: timestamp("granted_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
    revokedBy: uuid("revoked_by").references(() => users.id),
  },
  (table) => [
    check(
      "chapter_permissions_permission_check",
      sql.raw(
        `"chapter_permissions"."permission" in (${delegablePermissionValues
          .map((value) => `'${value}'`)
          .join(", ")})`,
      ),
    ),
    index("chapter_permissions_helper_chapter_idx").on(
      table.helperUserId,
      table.chapterId,
    ),
    index("chapter_permissions_chapter_idx").on(table.chapterId),
    uniqueIndex("chapter_permissions_active_unique")
      .on(table.chapterId, table.helperUserId, table.permission)
      .where(sql`${table.revokedAt} is null`),
  ],
);

export const helperSeriesCooldowns = pgTable(
  "helper_series_cooldowns",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    seriesId: uuid("series_id")
      .notNull()
      .references(() => series.id, { onDelete: "cascade" }),
    helperUserId: uuid("helper_user_id")
      .notNull()
      .references(() => users.id, { onDelete: "restrict" }),
    startsAt: timestamp("starts_at", { withTimezone: true }).notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    reason: text("reason").notNull(),
    sourceChapterId: uuid("source_chapter_id").references(() => chapters.id, {
      onDelete: "set null",
    }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    uniqueIndex("helper_series_cooldowns_scope_unique").on(
      table.seriesId,
      table.helperUserId,
    ),
    index("helper_series_cooldowns_expires_idx").on(table.expiresAt),
  ],
);
