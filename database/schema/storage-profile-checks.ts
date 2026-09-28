import { sql } from "drizzle-orm";
import {
  check,
  jsonb,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { storageProfiles } from "./storage-profiles.js";

export const storageProfileCheckTypeEnum = pgEnum(
  "storage_profile_check_type",
  [
    "b2_credentials",
    "b2_bucket",
    "b2_cors",
    "b2_lifecycle",
    "b2_storage_probe",
    "b2_browser_upload",
    "cloudflare_dns",
    "cloudflare_transform",
    "cloudflare_cache",
    "cloudflare_delivery",
  ],
);
export const storageProfileCheckStatusEnum = pgEnum(
  "storage_profile_check_status",
  ["pending", "checking", "verified", "manual_required", "failed"],
);

export const storageProfileChecks = pgTable(
  "storage_profile_checks",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    profileId: uuid("profile_id")
      .notNull()
      .references(() => storageProfiles.id, { onDelete: "cascade" }),
    checkType: storageProfileCheckTypeEnum("check_type").notNull(),
    status: storageProfileCheckStatusEnum("status")
      .notNull()
      .default("pending"),
    lastErrorCode: text("last_error_code"),
    metadata: jsonb("metadata")
      .$type<Record<string, string | number | boolean | null>>()
      .notNull()
      .default({}),
    checkedAt: timestamp("checked_at", { withTimezone: true }),
    verifiedAt: timestamp("verified_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    uniqueIndex("storage_profile_checks_profile_type_unique").on(
      table.profileId,
      table.checkType,
    ),
    check(
      "storage_profile_checks_verified_timestamp",
      sql`${table.status} <> 'verified' or ${table.verifiedAt} is not null`,
    ),
  ],
);
