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
});

const databaseConfigSchema = configSchema.pick({ DATABASE_URL: true });
const adminBootstrapConfigSchema = z.object({
  ADMIN_BOOTSTRAP_EMAIL: z.string().trim().toLowerCase().pipe(z.email()),
  ADMIN_BOOTSTRAP_PASSWORD: z.string().min(1),
});

export type NodeProxConfig = z.infer<typeof configSchema>;
export type NodeProxDatabaseConfig = z.infer<typeof databaseConfigSchema>;
export type NodeProxAdminBootstrapConfig = z.infer<
  typeof adminBootstrapConfigSchema
>;

export { adminBootstrapConfigSchema, configSchema, databaseConfigSchema };

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
