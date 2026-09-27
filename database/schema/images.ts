import { sql } from "drizzle-orm";
import {
  type AnyPgColumn,
  check,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
  varchar,
} from "drizzle-orm/pg-core";
import type { MediaWarning } from "@nodeprox/types";
import { chapterReplacementOperations } from "./chapter-replacement-operations.js";
import { chapters } from "./chapters.js";
import { storageProfiles } from "./storage-profiles.js";
export const images = pgTable(
  "images",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    chapterId: uuid("chapter_id")
      .notNull()
      .references(() => chapters.id, { onDelete: "cascade" }),
    filename: varchar("filename", { length: 255 }).notNull(),
    storageKey: varchar("storage_key", { length: 512 }).notNull(),
    storageProfileId: uuid("storage_profile_id")
      .notNull()
      .references(() => storageProfiles.id, { onDelete: "restrict" }),
    extension: varchar("extension", { length: 10 }).notNull(),
    contentType: varchar("content_type", { length: 128 }).notNull(),
    sizeBytes: integer("size_bytes").notNull(),
    sortOrder: integer("sort_order").notNull(),
    checksum: text("checksum").notNull(),
    warnings: jsonb("warnings")
      .$type<readonly MediaWarning[]>()
      .notNull()
      .default([]),
    currentVersionId: uuid("current_version_id")
      .notNull()
      .references((): AnyPgColumn => imageVersions.id, {
        onDelete: "restrict",
      }),
    retiredAt: timestamp("retired_at", { withTimezone: true }),
    retiredByChapterReplacementId: uuid(
      "retired_by_chapter_replacement_id",
    ).references(() => chapterReplacementOperations.id, {
      onDelete: "restrict",
    }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    uniqueIndex("images_chapter_filename_unique").on(
      table.chapterId,
      table.filename,
    ),
    index("images_chapter_idx").on(table.chapterId),
    index("images_storage_profile_id_idx").on(table.storageProfileId),
    index("images_chapter_sort_order_idx").on(table.chapterId, table.sortOrder),
    uniqueIndex("images_active_chapter_sort_order_unique")
      .on(table.chapterId, table.sortOrder)
      .where(sql`${table.retiredAt} is null`),
    check(
      "images_retirement_pair",
      sql`(${table.retiredAt} is null and ${table.retiredByChapterReplacementId} is null)
        or (${table.retiredAt} is not null and ${table.retiredByChapterReplacementId} is not null)`,
    ),
  ],
);

export const imageVersions = pgTable(
  "image_versions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    imageId: uuid("image_id")
      .notNull()
      .references(() => images.id, { onDelete: "cascade" }),
    version: integer("version").notNull(),
    physicalFilename: varchar("physical_filename", { length: 255 }).notNull(),
    storageKey: varchar("storage_key", { length: 512 }).notNull(),
    storageProfileId: uuid("storage_profile_id")
      .notNull()
      .references(() => storageProfiles.id, { onDelete: "restrict" }),
    extension: varchar("extension", { length: 10 }).notNull(),
    contentType: varchar("content_type", { length: 128 }).notNull(),
    sizeBytes: integer("size_bytes").notNull(),
    checksum: text("checksum").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    uniqueIndex("image_versions_image_version_unique").on(
      table.imageId,
      table.version,
    ),
    uniqueIndex("image_versions_storage_key_unique").on(table.storageKey),
    index("image_versions_image_idx").on(table.imageId),
    index("image_versions_storage_profile_id_idx").on(table.storageProfileId),
    check("image_versions_version_positive", sql`${table.version} > 0`),
  ],
);
