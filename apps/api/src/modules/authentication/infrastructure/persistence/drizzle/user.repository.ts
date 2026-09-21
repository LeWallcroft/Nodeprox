import {
  and,
  asc,
  count,
  eq,
  gt,
  ilike,
  isNull,
  max,
  or,
  sql,
} from "drizzle-orm";
import type { NodeProxDatabase } from "../../../../../../../../database/client.js";
import {
  auditLogs,
  chapterPermissions,
  seriesAssignments,
  sessions,
  users,
} from "../../../../../../../../database/schema/index.js";
import type { UserRepositoryPort } from "../../../domain/contracts/authentication.contracts.js";
import type { UserRecord } from "../../../domain/entities/authentication.types.js";

const toUserRecord = (user: typeof users.$inferSelect): UserRecord => ({
  ...user,
  status: user.status as UserRecord["status"],
});

export class UserRepository implements UserRepositoryPort {
  constructor(private readonly db: NodeProxDatabase) {}

  async findById(id: string): Promise<UserRecord | null> {
    const user =
      (
        await this.db.select().from(users).where(eq(users.id, id)).limit(1)
      )[0] ?? null;
    return user ? toUserRecord(user) : null;
  }

  async findByEmail(email: string): Promise<UserRecord | null> {
    const user =
      (
        await this.db
          .select()
          .from(users)
          .where(eq(users.email, email))
          .limit(1)
      )[0] ?? null;
    return user ? toUserRecord(user) : null;
  }

  async create(input: typeof users.$inferInsert): Promise<UserRecord> {
    const [user] = await this.db.insert(users).values(input).returning();
    if (!user) throw new Error("User insert returned no record");
    return toUserRecord(user);
  }

  async updatePasswordHash(id: string, passwordHash: string): Promise<void> {
    await this.db
      .update(users)
      .set({ passwordHash, updatedAt: new Date() })
      .where(eq(users.id, id));
  }

  async list() {
    const rows = await this.db.select().from(users);
    return rows.map(toUserRecord);
  }

  async listManagement(input: {
    search?: string | undefined;
    status?: UserRecord["status"] | undefined;
    role?: UserRecord["role"] | undefined;
    cursorEmail?: string | undefined;
    cursorId?: string | undefined;
    limit: number;
  }) {
    const conditions = [
      ...(input.search
        ? [
            or(
              ilike(users.email, `%${input.search}%`),
              ilike(users.discordUsername, `%${input.search}%`),
            ),
          ]
        : []),
      ...(input.status ? [eq(users.status, input.status)] : []),
      ...(input.role ? [eq(users.role, input.role)] : []),
      ...(input.cursorEmail && input.cursorId
        ? [
            or(
              gt(users.email, input.cursorEmail),
              and(
                eq(users.email, input.cursorEmail),
                gt(users.id, input.cursorId),
              ),
            ),
          ]
        : []),
    ];
    const where = conditions.length ? and(...conditions) : undefined;
    const [rows, totals] = await Promise.all([
      this.db
        .select({
          user: users,
          assignedSeriesCount: sql<number>`count(distinct ${seriesAssignments.id})::integer`,
          lastAccessAt: max(sessions.lastSeenAt),
        })
        .from(users)
        .leftJoin(
          seriesAssignments,
          eq(seriesAssignments.responsibleUserId, users.id),
        )
        .leftJoin(sessions, eq(sessions.userId, users.id))
        .where(where)
        .groupBy(users.id)
        .orderBy(asc(users.email), asc(users.id))
        .limit(input.limit + 1),
      this.db.select({ total: count() }).from(users).where(where),
    ]);
    return {
      items: rows.slice(0, input.limit).map((row) => ({
        ...toUserRecord(row.user),
        assignedSeriesCount: Number(row.assignedSeriesCount),
        lastAccessAt: row.lastAccessAt,
      })),
      total: totals[0]?.total ?? 0,
      hasMore: rows.length > input.limit,
    };
  }

  async lookup(input: {
    search?: string | undefined;
    cursorEmail?: string | undefined;
    cursorId?: string | undefined;
    limit: number;
  }) {
    const conditions = [
      ...(input.search
        ? [
            or(
              ilike(users.email, `%${input.search}%`),
              ilike(users.discordUsername, `%${input.search}%`),
            ),
          ]
        : []),
      ...(input.cursorEmail && input.cursorId
        ? [
            or(
              gt(users.email, input.cursorEmail),
              and(
                eq(users.email, input.cursorEmail),
                gt(users.id, input.cursorId),
              ),
            ),
          ]
        : []),
    ];
    const rows = await this.db
      .select()
      .from(users)
      .where(conditions.length ? and(...conditions) : undefined)
      .orderBy(asc(users.email), asc(users.id))
      .limit(input.limit + 1);
    return rows.map(toUserRecord);
  }

  async updateStatus(id: string, status: typeof users.$inferInsert.status) {
    const [row] = await this.db
      .update(users)
      .set({ status, updatedAt: new Date() })
      .where(eq(users.id, id))
      .returning();
    return row ? toUserRecord(row) : null;
  }

  async updateRole(id: string, role: typeof users.$inferInsert.role) {
    const [row] = await this.db
      .update(users)
      .set({ role, updatedAt: new Date() })
      .where(eq(users.id, id))
      .returning();
    return row ? toUserRecord(row) : null;
  }

  async review(input: {
    id: string;
    expectedStatus: UserRecord["status"];
    status: UserRecord["status"];
    role?: UserRecord["role"] | undefined;
  }): Promise<
    | { outcome: "updated"; user: UserRecord }
    | { outcome: "not-found" | "conflict" }
  > {
    const [row] = await this.db
      .update(users)
      .set({
        status: input.status,
        ...(input.role ? { role: input.role } : {}),
        updatedAt: new Date(),
      })
      .where(
        and(eq(users.id, input.id), eq(users.status, input.expectedStatus)),
      )
      .returning();
    if (row) return { outcome: "updated", user: toUserRecord(row) };
    return (await this.findById(input.id))
      ? { outcome: "conflict" }
      : { outcome: "not-found" };
  }

  async deactivate(input: {
    id: string;
    actorId: string;
    expectedStatus: "active";
  }) {
    const now = new Date();
    return this.db.transaction(async (transaction) => {
      const [user] = await transaction
        .update(users)
        .set({ status: "suspended", updatedAt: now })
        .where(
          and(eq(users.id, input.id), eq(users.status, input.expectedStatus)),
        )
        .returning();
      if (!user)
        return (
          await transaction
            .select({ id: users.id })
            .from(users)
            .where(eq(users.id, input.id))
            .limit(1)
        )[0]
          ? { outcome: "conflict" as const }
          : { outcome: "not-found" as const };

      const revokedSessions = await transaction
        .update(sessions)
        .set({ revokedAt: now })
        .where(and(eq(sessions.userId, input.id), isNull(sessions.revokedAt)))
        .returning({ id: sessions.id });
      const releasedAssignments = await transaction
        .delete(seriesAssignments)
        .where(eq(seriesAssignments.responsibleUserId, input.id))
        .returning({ id: seriesAssignments.id });
      const revokedCollaborations = await transaction
        .update(chapterPermissions)
        .set({ revokedAt: now, revokedBy: input.actorId })
        .where(
          and(
            eq(chapterPermissions.helperUserId, input.id),
            isNull(chapterPermissions.revokedAt),
          ),
        )
        .returning({ id: chapterPermissions.id });

      await transaction.insert(auditLogs).values({
        actorId: input.actorId,
        action: "user.deactivated",
        resourceType: "user",
        resourceId: input.id,
        result: "success",
        metadata: {
          revokedSessions: revokedSessions.length,
          releasedSeriesAssignments: releasedAssignments.length,
          revokedChapterCollaborations: revokedCollaborations.length,
        },
      });
      return {
        outcome: "deactivated" as const,
        result: {
          user: toUserRecord(user),
          revokedSessions: revokedSessions.length,
          releasedSeriesAssignments: releasedAssignments.length,
          revokedChapterCollaborations: revokedCollaborations.length,
        },
      };
    });
  }
}
