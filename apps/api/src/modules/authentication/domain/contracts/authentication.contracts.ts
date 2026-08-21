import type {
  AuthenticatedPrincipal,
  CreateSessionInput,
  SessionRecord,
  SessionWithUser,
  UserRecord,
} from "../entities/authentication.types.js";

export interface UserRepositoryPort {
  findById(id: string): Promise<UserRecord | null>;
  findByEmail(email: string): Promise<UserRecord | null>;
  updatePasswordHash(id: string, passwordHash: string): Promise<void>;
}

export interface SessionRepositoryPort {
  create(input: CreateSessionInput): Promise<SessionRecord>;
  findValidByTokenHash(
    tokenHash: string,
    now: Date,
  ): Promise<SessionWithUser | null>;
  findByTokenHash(tokenHash: string): Promise<SessionWithUser | null>;
  touch(id: string, lastSeenAt: Date, expiresAt: Date): Promise<void>;
  revokeById(id: string, revokedAt: Date): Promise<void>;
  rotate(
    id: string,
    input: CreateSessionInput,
    revokedAt: Date,
  ): Promise<SessionRecord | null>;
}

export interface PasswordHasherPort {
  hash(password: string): Promise<string>;
  verify(hash: string, password: string): Promise<boolean>;
  verifyDummy(password: string): Promise<boolean>;
  needsRehash(hash: string): boolean;
}

export interface SessionServicePort {
  authenticate(input: {
    email: string;
    password: string;
  }): Promise<{ principal: AuthenticatedPrincipal; token: string }>;
  resolve(token: string): Promise<{
    principal: AuthenticatedPrincipal;
    user: Pick<UserRecord, "id" | "email" | "status">;
    rotatedToken?: string;
  } | null>;
  revoke(token: string): Promise<void>;
}
