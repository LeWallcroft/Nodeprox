import { z } from "zod";

const configSchema = z.object({
  NODE_ENV: z
    .enum(["development", "test", "production"])
    .default("development"),
  API_HOST: z.string().default("127.0.0.1"),
  API_PORT: z.coerce.number().int().positive().default(3000),
  LOG_LEVEL: z
    .enum(["fatal", "error", "warn", "info", "debug", "trace", "silent"])
    .default("info"),
  DATABASE_URL: z.url(),
  REDIS_URL: z.url(),
  UPLOAD_MAX_SIZE_BYTES: z.coerce.number().int().positive().default(536870912),
  B2_ENDPOINT: z.url().optional(),
  B2_REGION: z.string().trim().min(1).optional(),
  B2_BUCKET: z.string().trim().min(1).optional(),
  B2_KEY_ID: z.string().trim().min(1).optional(),
  B2_APPLICATION_KEY: z.string().trim().min(1).optional(),
});

const databaseConfigSchema = configSchema.pick({ DATABASE_URL: true });
const adminBootstrapConfigSchema = z.object({
  ADMIN_BOOTSTRAP_EMAIL: z.string().trim().toLowerCase().pipe(z.email()),
  ADMIN_BOOTSTRAP_PASSWORD: z.string().min(1),
});
const b2ConfigSchema = z.object({
  B2_ENDPOINT: z.url(),
  B2_REGION: z.string().trim().min(1),
  B2_BUCKET: z.string().trim().min(1),
  B2_KEY_ID: z.string().trim().min(1),
  B2_APPLICATION_KEY: z.string().trim().min(1),
});

export type NodeProxConfig = z.infer<typeof configSchema>;
export type NodeProxDatabaseConfig = z.infer<typeof databaseConfigSchema>;
export type NodeProxAdminBootstrapConfig = z.infer<
  typeof adminBootstrapConfigSchema
>;
export type NodeProxStorageConfig =
  | { provider: "filesystem"; uploadMaxSizeBytes: number }
  | {
      provider: "b2";
      uploadMaxSizeBytes: number;
      b2: z.infer<typeof b2ConfigSchema>;
    };

export {
  adminBootstrapConfigSchema,
  b2ConfigSchema,
  configSchema,
  databaseConfigSchema,
};

export function loadConfig(
  env: Readonly<Record<string, string | undefined>> = process.env,
): NodeProxConfig {
  return configSchema.parse(env);
}

export function loadDatabaseConfig(
  env: Readonly<Record<string, string | undefined>> = process.env,
): NodeProxDatabaseConfig {
  return databaseConfigSchema.parse(env);
}

export function loadAdminBootstrapConfig(
  env: Readonly<Record<string, string | undefined>> = process.env,
): NodeProxAdminBootstrapConfig {
  return adminBootstrapConfigSchema.parse(env);
}

export function loadStorageConfig(
  env: Readonly<Record<string, string | undefined>> = process.env,
): NodeProxStorageConfig {
  const parsed = configSchema
    .pick({ NODE_ENV: true, UPLOAD_MAX_SIZE_BYTES: true })
    .parse(env);
  if (parsed.NODE_ENV !== "production")
    return {
      provider: "filesystem",
      uploadMaxSizeBytes: parsed.UPLOAD_MAX_SIZE_BYTES,
    };
  return {
    provider: "b2",
    uploadMaxSizeBytes: parsed.UPLOAD_MAX_SIZE_BYTES,
    b2: b2ConfigSchema.parse(env),
  };
}
