import { z } from "zod";

export const DEFAULT_PUBLIC_MEDIA_ORIGIN = "https://media.nodeprox.org";

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
  PUBLIC_MEDIA_ORIGIN: z
    .url()
    .default(DEFAULT_PUBLIC_MEDIA_ORIGIN)
    .refine((value) => {
      const url = new URL(value);
      return (
        (url.protocol === "https:" || url.protocol === "http:") &&
        (url.pathname === "/" || url.pathname === "") &&
        !url.search &&
        !url.hash
      );
    }, "PUBLIC_MEDIA_ORIGIN must be an absolute HTTP(S) origin without a path"),
  UPLOAD_MAX_SIZE_BYTES: z.coerce.number().int().positive().default(536870912),
  UPLOAD_PENDING_TTL_SECONDS: z.coerce.number().int().positive().default(86400),
  STORAGE_PROVIDER: z.enum(["filesystem", "b2"]).optional(),
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
const processingConfigSchema = z.object({
  REDIS_URL: z.url(),
  PROCESSING_QUEUE_NAME: z.string().trim().min(1).default("chapter-processing"),
  PROCESSING_MAX_ENTRIES: z.coerce.number().int().positive().default(1000),
  PROCESSING_MAX_TOTAL_SIZE_BYTES: z.coerce
    .number()
    .int()
    .positive()
    .default(536870912),
  PROCESSING_MAX_IMAGE_SIZE_BYTES: z.coerce
    .number()
    .int()
    .positive()
    .default(67108864),
});

export type NodeProxConfig = z.infer<typeof configSchema>;
export type NodeProxDatabaseConfig = z.infer<typeof databaseConfigSchema>;
export type NodeProxAdminBootstrapConfig = z.infer<
  typeof adminBootstrapConfigSchema
>;
export type NodeProxStorageConfig =
  | {
      provider: "filesystem";
      uploadMaxSizeBytes: number;
      uploadPendingTtlSeconds?: number;
    }
  | {
      provider: "b2";
      uploadMaxSizeBytes: number;
      uploadPendingTtlSeconds?: number;
      b2: z.infer<typeof b2ConfigSchema>;
    };
export type NodeProxProcessingConfig = z.infer<typeof processingConfigSchema>;

export {
  adminBootstrapConfigSchema,
  b2ConfigSchema,
  configSchema,
  databaseConfigSchema,
  processingConfigSchema,
};

export function loadConfig(
  env: Readonly<Record<string, string | undefined>> = process.env,
): NodeProxConfig {
  return configSchema.parse(env);
}

export function loadProcessingConfig(
  env: Readonly<Record<string, string | undefined>> = process.env,
): NodeProxProcessingConfig {
  return processingConfigSchema.parse(env);
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
    .pick({
      NODE_ENV: true,
      UPLOAD_MAX_SIZE_BYTES: true,
      UPLOAD_PENDING_TTL_SECONDS: true,
      STORAGE_PROVIDER: true,
    })
    .parse(env);
  const provider =
    parsed.STORAGE_PROVIDER ??
    (parsed.NODE_ENV === "production" ? "b2" : "filesystem");
  if (parsed.NODE_ENV === "production" && provider !== "b2")
    throw new Error("Production storage provider must be b2");
  if (provider === "filesystem")
    return {
      provider: "filesystem",
      uploadMaxSizeBytes: parsed.UPLOAD_MAX_SIZE_BYTES,
      uploadPendingTtlSeconds: parsed.UPLOAD_PENDING_TTL_SECONDS,
    };
  return {
    provider: "b2",
    uploadMaxSizeBytes: parsed.UPLOAD_MAX_SIZE_BYTES,
    uploadPendingTtlSeconds: parsed.UPLOAD_PENDING_TTL_SECONDS,
    b2: b2ConfigSchema.parse(env),
  };
}
