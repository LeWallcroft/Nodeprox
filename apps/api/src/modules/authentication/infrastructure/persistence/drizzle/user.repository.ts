import { eq } from "drizzle-orm";
import type { NodeProxDatabase } from "../../../../../../../../database/client.js";
import { users } from "../../../../../../../../database/schema/index.js";
import type { UserRecord } from "../../../domain/entities/authentication.types.js";
import type { UserRepositoryPort } from "../../../domain/contracts/authentication.contracts.js";

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
}
