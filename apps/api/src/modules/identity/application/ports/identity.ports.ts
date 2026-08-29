import type {
  UserRecord,
  UserStatus,
} from "../../../authentication/domain/entities/authentication.types.js";

export type IdentityRole = "admin" | "gestor" | "uploader";

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
  review(input: {
    id: string;
    expectedStatus: UserStatus;
    status: UserStatus;
    role?: IdentityRole | undefined;
  }): Promise<
    | { outcome: "updated"; user: UserRecord }
    | { outcome: "not-found" | "conflict" }
  >;
}
