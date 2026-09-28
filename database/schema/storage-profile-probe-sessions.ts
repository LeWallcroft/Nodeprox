import { pgTable, text, timestamp, uuid, integer } from "drizzle-orm/pg-core";
import { storageProfiles } from "./storage-profiles.js";

export const storageProfileProbeSessions = pgTable(
  "storage_profile_probe_sessions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    profileId: uuid("profile_id")
      .notNull()
      .references(() => storageProfiles.id, { onDelete: "cascade" }),
    storageKey: text("storage_key").notNull(),
    expectedSha256: text("expected_sha256").notNull(),
    expectedSizeBytes: integer("expected_size_bytes").notNull(),
    contentType: text("content_type").notNull(),
    status: text("status").notNull().default("pending"),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    completedAt: timestamp("completed_at", { withTimezone: true }),
  },
);
