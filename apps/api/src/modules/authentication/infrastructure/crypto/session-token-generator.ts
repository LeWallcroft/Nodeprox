import { createHash, randomBytes, randomUUID } from "node:crypto";

export function createSessionId(): string {
  return randomUUID();
}

export function createSessionToken(): string {
  return randomBytes(32).toString("base64url");
}

export function hashSessionToken(token: string): string {
  return createHash("sha256").update(token, "utf8").digest("hex");
}
