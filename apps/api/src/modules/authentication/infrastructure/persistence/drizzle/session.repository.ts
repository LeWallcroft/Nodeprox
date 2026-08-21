import { and, eq, gt, isNull } from "drizzle-orm";
import type { NodeProxDatabase } from "../../../../../../../../database/client.js";
import {
  sessions,
  users,
} from "../../../../../../../../database/schema/index.js";
import type {
  CreateSessionInput,
  SessionWithUser,
} from "../../../domain/entities/authentication.types.js";
import type { SessionRepositoryPort } from "../../../domain/contracts/authentication.contracts.js";

const normalizeUser = (user: typeof users.$inferSelect) => ({
  ...user,
  status: user.status as SessionWithUser["user"]["status"],
});

export class SessionRepository implements SessionRepositoryPort {
  constructor(private readonly db: NodeProxDatabase) {}

  async create(input: CreateSessionInput) {
    const [session] = await this.db.insert(sessions).values(input).returning();
    if (!session) throw new Error("Session insert returned no record");
    return session;
  }

  async findValidByTokenHash(
    tokenHash: string,
    now: Date,
  ): Promise<SessionWithUser | null> {
    const result = await this.db
      .select({ session: sessions, user: users })
      .from(sessions)
      .innerJoin(users, eq(users.id, sessions.userId))
      .where(
        and(
          eq(sessions.tokenHash, tokenHash),
          isNull(sessions.revokedAt),
          gt(sessions.expiresAt, now),
          gt(sessions.absoluteExpiresAt, now),
          eq(users.status, "active"),
        ),
      )
      .limit(1);
    const row = result[0];
    return row ? { session: row.session, user: normalizeUser(row.user) } : null;
  }

  async findByTokenHash(tokenHash: string): Promise<SessionWithUser | null> {
    const result = await this.db
      .select({ session: sessions, user: users })
      .from(sessions)
      .innerJoin(users, eq(users.id, sessions.userId))
      .where(eq(sessions.tokenHash, tokenHash))
      .limit(1);
    const row = result[0];
    return row ? { session: row.session, user: normalizeUser(row.user) } : null;
  }

  async revokeById(sessionId: string, revokedAt: Date): Promise<void> {
    await this.db
      .update(sessions)
      .set({ revokedAt })
      .where(and(eq(sessions.id, sessionId), isNull(sessions.revokedAt)));
  }

  async touch(
    sessionId: string,
    lastSeenAt: Date,
    expiresAt: Date,
  ): Promise<void> {
    await this.db
      .update(sessions)
      .set({ lastSeenAt, expiresAt })
      .where(
        and(
          eq(sessions.id, sessionId),
          isNull(sessions.revokedAt),
          gt(sessions.expiresAt, lastSeenAt),
        ),
      );
  }

  async rotate(sessionId: string, input: CreateSessionInput, revokedAt: Date) {
    return this.db.transaction(async (transaction) => {
      const current = await transaction
        .select({ id: sessions.id })
        .from(sessions)
        .where(and(eq(sessions.id, sessionId), isNull(sessions.revokedAt)))
        .limit(1);
      if (!current[0]) return null;
      const revoked = await transaction
        .update(sessions)
        .set({ revokedAt })
        .where(and(eq(sessions.id, sessionId), isNull(sessions.revokedAt)))
        .returning({ id: sessions.id });
      if (!revoked[0]) return null;
      const [next] = await transaction
        .insert(sessions)
        .values(input)
        .returning();
      return next ?? null;
    });
  }
}
