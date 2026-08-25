import type {
  UserRecord,
  UserStatus,
} from "../../../authentication/domain/entities/authentication.types.js";

export type IdentityRole = "admin" | "gestor" | "uploader";

export interface IdentityUserRepositoryPort {
  create(input: {
    id: string;
    email: string;
    passwordHash: string;
    status: UserStatus;
    role: IdentityRole;
  }): Promise<UserRecord>;
  findByEmail(email: string): Promise<UserRecord | null>;
  findById(id: string): Promise<UserRecord | null>;
  list(): Promise<UserRecord[]>;
  updateStatus(id: string, status: UserStatus): Promise<UserRecord | null>;
  updateRole(id: string, role: IdentityRole): Promise<UserRecord | null>;
}
