import { pgTable, text, timestamp } from "drizzle-orm/pg-core";

export const bootstrapMetadata = pgTable("bootstrap_metadata", {
  id: text("id").primaryKey(),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});
