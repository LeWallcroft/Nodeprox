import pino, { type Logger } from "pino";

export function createBotLogger(level: string): Logger {
  return pino({
    level,
    redact: {
      paths: [
        "authorization",
        "headers.authorization",
        "discordBotToken",
        "internalToken",
        "code",
      ],
      censor: "[REDACTED]",
    },
  });
}
