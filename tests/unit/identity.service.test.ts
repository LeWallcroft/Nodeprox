import { describe, expect, it } from "vitest";
import type { UserRecord } from "../../apps/api/src/modules/authentication/domain/entities/authentication.types.js";
import type { IdentityUserRepositoryPort } from "../../apps/api/src/modules/identity/application/ports/identity.ports.js";
import { IdentityService } from "../../apps/api/src/modules/identity/application/services/identity.service.js";

const context = { userId: "admin-1", sessionId: "session-1" };

function user(overrides: Partial<UserRecord> = {}): UserRecord {
  return {
    id: "user-1",
    email: "user@example.com",
    passwordHash: "hash",
    status: "pending",
    role: "uploader",
    createdAt: new Date(0),
    updatedAt: new Date(0),
    ...overrides,
  };
}

class FakeUsers implements IdentityUserRepositoryPort {
  records = [user()];
  async create(input: Parameters<IdentityUserRepositoryPort["create"]>[0]) {
    const created = user(input);
    this.records.push(created);
    return created;
  }
  async findByEmail(email: string) {
    return this.records.find((record) => record.email === email) ?? null;
  }
  async findById(id: string) {
    return this.records.find((record) => record.id === id) ?? null;
  }
  async list() {
    return this.records;
  }
  async listManagement(
    input: Parameters<IdentityUserRepositoryPort["listManagement"]>[0],
  ) {
    const items = this.records.slice(0, input.limit).map((record) => ({
      ...record,
      assignedSeriesCount: 0,
      lastAccessAt: null,
    }));
    return {
      items,
      total: this.records.length,
      hasMore: this.records.length > items.length,
    };
  }
  async lookup() {
    return this.records;
  }
  async review(input: {
    id: string;
    expectedStatus: UserRecord["status"];
    status: UserRecord["status"];
    role?: "admin" | "gestor" | "uploader" | undefined;
  }) {
    const record = await this.findById(input.id);
    if (!record) return { outcome: "not-found" as const };
    if (record.status !== input.expectedStatus)
      return { outcome: "conflict" as const };
    record.status = input.status;
    if (input.role) record.role = input.role;
    return { outcome: "updated" as const, user: record };
  }
  async updateStatus(id: string, status: UserRecord["status"]) {
    const record = await this.findById(id);
    if (!record) return null;
    record.status = status;
    return record;
  }
  async updateRole(id: string, role: "admin" | "gestor" | "uploader") {
    const record = await this.findById(id);
    if (!record) return null;
    record.role = role;
    return record;
  }
  async deactivate(input: {
    id: string;
    actorId: string;
    expectedStatus: "active";
  }) {
    const record = await this.findById(input.id);
    if (!record) return { outcome: "not-found" as const };
    if (record.status !== input.expectedStatus)
      return { outcome: "conflict" as const };
    record.status = "suspended";
    return {
      outcome: "deactivated" as const,
      result: {
        user: record,
        revokedSessions: 1,
        releasedSeriesAssignments: 2,
        revokedChapterCollaborations: 3,
      },
    };
  }
}

const passwords = {
  hash: async (value: string) => `hashed:${value}`,
  verify: async () => true,
  verifyDummy: async () => true,
  needsRehash: () => false,
};

describe("A1 identity service", () => {
  it("registers users as pending uploaders and never accepts a client role", async () => {
    const users = new FakeUsers();
    const service = new IdentityService(users, passwords, {
      authorize: async () => ({ allowed: true, role: "admin" }),
    } as never);
    const created = await service.register({
      email: "New@Example.com",
      password: "correct horse battery staple",
    });
    expect(created).toMatchObject({
      email: "new@example.com",
      status: "pending",
      role: "uploader",
    });
    expect(created).not.toHaveProperty("passwordHash");
  });

  it("allows only an admin to approve and assign a role", async () => {
    const users = new FakeUsers();
    const service = new IdentityService(users, passwords, {
      authorize: async () => ({ allowed: true, role: "admin" }),
    } as never);
    const approved = await service.review(context, "user-1", {
      status: "active",
      role: "gestor",
    });
    expect(approved).toMatchObject({ status: "active", role: "gestor" });
  });

  it("fails closed for non-admin review", async () => {
    const service = new IdentityService(new FakeUsers(), passwords, {
      authorize: async () => ({ allowed: false, reason: "permission-denied" }),
    } as never);
    await expect(
      service.review(context, "user-1", { status: "active", role: "uploader" }),
    ).rejects.toMatchObject({ statusCode: 403 });
  });

  it("rejects invalid status transitions", async () => {
    const users = new FakeUsers();
    const service = new IdentityService(users, passwords, {
      authorize: async () => ({ allowed: true, role: "admin" }),
    } as never);
    await expect(
      service.review(context, "user-1", { status: "suspended" }),
    ).rejects.toMatchObject({ name: "IdentityStateConflictError" });
    expect(users.records[0]?.status).toBe("pending");
  });

  it("deactivates active users through the lifecycle cleanup operation", async () => {
    const users = new FakeUsers();
    const target = users.records[0];
    if (!target) throw new Error("Expected fixture user");
    target.status = "active";
    const service = new IdentityService(users, passwords, {
      authorize: async () => ({ allowed: true, role: "admin" }),
    } as never);

    await expect(
      service.review(context, "user-1", { status: "suspended" }),
    ).resolves.toMatchObject({ status: "suspended" });
  });
});
