import { describe, expect, it } from "vitest";
import { SessionService } from "../../apps/api/src/modules/authentication/application/services/session.service.js";
import type {
  PasswordHasherPort,
  SessionRepositoryPort,
  UserRepositoryPort,
} from "../../apps/api/src/modules/authentication/domain/contracts/authentication.contracts.js";
import type {
  CreateSessionInput,
  SessionRecord,
  SessionWithUser,
  UserRecord,
} from "../../apps/api/src/modules/authentication/domain/entities/authentication.types.js";

const user = (status: UserRecord["status"] = "active"): UserRecord => ({
  id: "user-1",
  email: "user@example.com",
  passwordHash: "hash",
  status,
  createdAt: new Date(0),
  updatedAt: new Date(0),
});

const session = (overrides: Partial<SessionRecord> = {}): SessionRecord => ({
  id: "session-1",
  userId: "user-1",
  tokenHash: "token-hash",
  createdAt: new Date(),
  expiresAt: new Date(Date.now() + 30 * 86_400_000),
  absoluteExpiresAt: new Date(Date.now() + 90 * 86_400_000),
  revokedAt: null,
  lastSeenAt: new Date(),
  ip: null,
  userAgent: null,
  metadata: null,
  ...overrides,
});

class FakeUsers implements UserRepositoryPort {
  current: UserRecord | null = user();
  rehashed = false;
  async findById(): Promise<UserRecord | null> {
    return this.current;
  }
  async findByEmail(): Promise<UserRecord | null> {
    return this.current;
  }
  async updatePasswordHash(): Promise<void> {
    this.rehashed = true;
  }
}

class FakePasswords implements PasswordHasherPort {
  dummy = false;
  rehash = false;
  async hash(): Promise<string> {
    return "new-hash";
  }
  async verify(): Promise<boolean> {
    return true;
  }
  async verifyDummy(): Promise<boolean> {
    this.dummy = true;
    return false;
  }
  needsRehash(): boolean {
    return this.rehash;
  }
}

class FakeSessions implements SessionRepositoryPort {
  current: SessionWithUser | null = { session: session(), user: user() };
  touched = false;
  rotated = false;
  async create(input: CreateSessionInput): Promise<SessionRecord> {
    return { ...session(), ...input };
  }
  async findValidByTokenHash(): Promise<SessionWithUser | null> {
    return this.current;
  }
  async findByTokenHash(): Promise<SessionWithUser | null> {
    return this.current;
  }
  async touch(): Promise<void> {
    this.touched = true;
  }
  async revokeById(): Promise<void> {}
  async rotate(
    _id: string,
    input: CreateSessionInput,
  ): Promise<SessionRecord | null> {
    this.rotated = true;
    return { ...session(), ...input };
  }
}

describe("SessionService security and lifecycle", () => {
  it("uses the dummy Argon2 path for an unknown user", async () => {
    const users = new FakeUsers();
    users.current = null;
    const passwords = new FakePasswords();
    await expect(
      new SessionService(users, new FakeSessions(), passwords).authenticate({
        email: "missing@example.com",
        password: "x",
      }),
    ).rejects.toMatchObject({ statusCode: 401 });
    expect(passwords.dummy).toBe(true);
  });

  it.each(["suspended", "disabled"] as const)(
    "rejects a %s user",
    async (status) => {
      const users = new FakeUsers();
      users.current = user(status);
      await expect(
        new SessionService(
          users,
          new FakeSessions(),
          new FakePasswords(),
        ).authenticate({ email: "user@example.com", password: "x" }),
      ).rejects.toMatchObject({ statusCode: 401 });
    },
  );

  it("rehashes a valid password when required", async () => {
    const users = new FakeUsers();
    const passwords = new FakePasswords();
    passwords.rehash = true;
    await new SessionService(users, new FakeSessions(), passwords).authenticate(
      { email: "user@example.com", password: "x" },
    );
    expect(users.rehashed).toBe(true);
  });

  it("touches idle sessions and never renews beyond absolute expiry", async () => {
    const sessions = new FakeSessions();
    sessions.current = {
      session: session({
        lastSeenAt: new Date(Date.now() - 10 * 60_000),
        absoluteExpiresAt: new Date(Date.now() + 60_000),
      }),
      user: user(),
    };
    const result = await new SessionService(
      new FakeUsers(),
      sessions,
      new FakePasswords(),
    ).resolve("token");
    expect(result).not.toBeNull();
    expect(sessions.touched).toBe(true);
  });

  it("treats expired or invalid sessions as anonymous", async () => {
    const sessions = new FakeSessions();
    sessions.current = null;
    expect(
      await new SessionService(
        new FakeUsers(),
        sessions,
        new FakePasswords(),
      ).resolve("invalid"),
    ).toBeNull();
  });

  it("accepts a successful transactional rotation", async () => {
    const sessions = new FakeSessions();
    sessions.current = {
      session: session({ expiresAt: new Date(Date.now() + 60_000) }),
      user: user(),
    };
    const result = await new SessionService(
      new FakeUsers(),
      sessions,
      new FakePasswords(),
    ).resolve("token");
    expect(result?.rotatedToken).toBeTypeOf("string");
    expect(sessions.rotated).toBe(true);
  });

  it("fails closed when a concurrent rotation wins the race", async () => {
    const sessions = new FakeSessions();
    sessions.current = {
      session: session({ expiresAt: new Date(Date.now() + 60_000) }),
      user: user(),
    };
    sessions.rotate = async () => null;
    expect(
      await new SessionService(
        new FakeUsers(),
        sessions,
        new FakePasswords(),
      ).resolve("token"),
    ).toBeNull();
  });
});
