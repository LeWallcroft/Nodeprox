export type UserStatus =
  | "pending"
  | "active"
  | "rejected"
  | "suspended"
  | "disabled";

export interface UserRecord {
  id: string;
  email: string;
  discordUsername?: string | null;
  passwordHash: string;
  status: UserStatus;
  role?: "admin" | "gestor" | "uploader";
  createdAt: Date;
  updatedAt: Date;
}

export interface SessionRecord {
  id: string;
  userId: string;
  tokenHash: string;
  createdAt: Date;
  expiresAt: Date;
  absoluteExpiresAt: Date;
  revokedAt: Date | null;
  lastSeenAt: Date | null;
  ip: string | null;
  userAgent: string | null;
  metadata: Record<string, unknown> | null;
}

export type CreateSessionInput = Omit<
  SessionRecord,
  "revokedAt" | "lastSeenAt" | "ip" | "userAgent" | "metadata"
> & {
  revokedAt?: Date | null;
  lastSeenAt?: Date | null;
  ip?: string | null;
  userAgent?: string | null;
  metadata?: Record<string, unknown> | null;
};

export interface AuthenticatedPrincipal {
  userId: string;
  sessionId: string;
}

export interface SessionWithUser {
  session: SessionRecord;
  user: UserRecord;
}
