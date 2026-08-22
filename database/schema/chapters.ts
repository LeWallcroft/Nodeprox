import { sql } from "drizzle-orm";
import {
  check,
  index,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { users } from "./authentication.js";

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
    seriesId: uuid("series_id").notNull(),
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
  (table) => [index("chapters_series_id_idx").on(table.seriesId)],
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
