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

export type NodeProxConfig = z.infer<typeof configSchema>;
export type NodeProxDatabaseConfig = z.infer<typeof databaseConfigSchema>;

export { configSchema, databaseConfigSchema };

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
