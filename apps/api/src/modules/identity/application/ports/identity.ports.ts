import type {
  UserRecord,
  UserStatus,
} from "../../../authentication/domain/entities/authentication.types.js";

export type IdentityRole = "admin" | "gestor" | "uploader";

export type UserDeactivationResult = {
  user: UserRecord;
  revokedSessions: number;
  releasedSeriesAssignments: number;
  revokedChapterCollaborations: number;
};

export type ManagedUserReadModel = UserRecord & {
  assignedSeriesCount: number;
  lastAccessAt: Date | null;
};

export interface IdentityUserRepositoryPort {
  create(input: {
    id: string;
    email: string;
    discordUsername?: string | null;
    passwordHash: string;
    status: UserStatus;
    role: IdentityRole;
  }): Promise<UserRecord>;
  findByEmail(email: string): Promise<UserRecord | null>;
  findById(id: string): Promise<UserRecord | null>;
  list(): Promise<UserRecord[]>;
  listManagement(input: {
    search?: string | undefined;
    status?: UserStatus | undefined;
    role?: IdentityRole | undefined;
    cursorEmail?: string | undefined;
    cursorId?: string | undefined;
    limit: number;
  }): Promise<{
    items: ManagedUserReadModel[];
    total: number;
    hasMore: boolean;
  }>;
  lookup(input: {
    search?: string | undefined;
    cursorEmail?: string | undefined;
    cursorId?: string | undefined;
    limit: number;
  }): Promise<UserRecord[]>;
  review(input: {
    id: string;
    expectedStatus: UserStatus;
    status: UserStatus;
    role?: IdentityRole | undefined;
  }): Promise<
    | { outcome: "updated"; user: UserRecord }
    | { outcome: "not-found" | "conflict" }
  >;
  deactivate(input: {
    id: string;
    actorId: string;
    expectedStatus: Extract<UserStatus, "active">;
  }): Promise<
    | { outcome: "deactivated"; result: UserDeactivationResult }
    | { outcome: "not-found" | "conflict" }
  >;
}
