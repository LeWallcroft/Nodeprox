import { z } from "zod";

const configSchema = z.object({
  NODE_ENV: z
    .enum(["development", "test", "production"])
    .default("development"),
  API_HOST: z.string().default("127.0.0.1"),
  API_PORT: z.coerce.number().int().positive().default(3000),
  DATABASE_URL: z.url(),
  REDIS_URL: z.url(),
});

export type NodeProxConfig = z.infer<typeof configSchema>;

export function loadConfig(
  env: NodeJS.ProcessEnv = process.env,
): NodeProxConfig {
  return configSchema.parse(env);
}
