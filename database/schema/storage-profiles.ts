import { sql } from "drizzle-orm";
import {
  check,
  integer,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
  varchar,
} from "drizzle-orm/pg-core";

export const storageProfileProviderEnum = pgEnum("storage_profile_provider", [
  "b2",
]);
export const storageProfileSourceEnum = pgEnum("storage_profile_source", [
  "env",
  "managed",
]);
export const storageProfileStatusEnum = pgEnum("storage_profile_status", [
  "draft",
  "ready",
  "active",
  "retired",
]);
export const cloudflareProvisioningStatusEnum = pgEnum(
  "cloudflare_provisioning_status",
  ["pending", "provisioning", "verified", "failed"],
);

export const storageProfiles = pgTable(
  "storage_profiles",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    provider: storageProfileProviderEnum("provider").notNull(),
    source: storageProfileSourceEnum("source").notNull(),
    status: storageProfileStatusEnum("status").notNull(),
    name: varchar("name", { length: 120 }).notNull(),
    publicHostnameLabel: varchar("public_hostname_label", {
      length: 63,
    }).notNull(),
    publicHostname: varchar("public_hostname", { length: 253 }).notNull(),
    b2Endpoint: text("b2_endpoint"),
    b2Region: text("b2_region"),
    b2Bucket: text("b2_bucket"),
    b2KeyId: text("b2_key_id"),
    encryptedApplicationKey: text("encrypted_application_key"),
    credentialVersion: integer("credential_version").notNull().default(0),
    dnsRecordId: text("dns_record_id"),
    transformRulesetId: text("transform_ruleset_id"),
    transformRuleId: text("transform_rule_id"),
    cacheRulesetId: text("cache_ruleset_id"),
    cloudflareProvisioningVersion: integer("cloudflare_provisioning_version")
      .notNull()
      .default(0),
    cloudflareProvisioningStatus: cloudflareProvisioningStatusEnum(
      "cloudflare_provisioning_status",
    )
      .notNull()
      .default("pending"),
    cloudflareLastErrorCode: text("cloudflare_last_error_code"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    uniqueIndex("storage_profiles_public_hostname_unique").on(
      table.publicHostname,
    ),
    uniqueIndex("storage_profiles_hostname_label_unique").on(
      table.publicHostnameLabel,
    ),
    check(
      "storage_profiles_legacy_secret_absent",
      sql`${table.source} <> 'env' or (${table.encryptedApplicationKey} is null and ${table.b2KeyId} is null and ${table.b2Bucket} is null and ${table.b2Endpoint} is null and ${table.b2Region} is null)`,
    ),
    check(
      "storage_profiles_legacy_hostname_fixed",
      sql`${table.source} <> 'env' or (${table.publicHostnameLabel} = 'media' and ${table.publicHostname} = 'media.nodeprox.org')`,
    ),
    check(
      "storage_profiles_credential_version_nonnegative",
      sql`${table.credentialVersion} >= 0`,
    ),
    check(
      "storage_profiles_env_version_zero",
      sql`${table.source} <> 'env' or ${table.credentialVersion} = 0`,
    ),
    check(
      "storage_profiles_env_active",
      sql`${table.source} <> 'env' or ${table.status} = 'active'`,
    ),
  ],
);
