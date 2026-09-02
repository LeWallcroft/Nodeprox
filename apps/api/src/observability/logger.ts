/** Shared Pino/Fastify logger defaults. Values are redacted structurally. */
export const API_LOGGER_OPTIONS = {
  redact: {
    paths: [
      "req.headers.authorization",
      "req.headers.cookie",
      "res.headers.set-cookie",
      "authorization",
      "cookie",
      "setCookie",
      "password",
      "passwordHash",
      "token",
      "accessToken",
      "refreshToken",
      "B2_APPLICATION_KEY",
      "B2_KEY_ID",
      "DATABASE_URL",
      "REDIS_URL",
      "presignedUrl",
      "presignedUrls",
    ],
    censor: "[REDACTED]",
  },
};
