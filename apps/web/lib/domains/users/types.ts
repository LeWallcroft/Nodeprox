export type ManagedUserStatus = "pending" | "active" | "rejected" | "suspended";
export type ManagedUserRole = "admin" | "gestor" | "uploader";

export type ManagedUser = UserReference & {
  status: ManagedUserStatus;
  role?: ManagedUserRole;
  createdAt: string;
  updatedAt: string;
};

export type ManagedUserProjection = ManagedUser & {
  assignedSeriesCount: number;
  lastAccessAt: string | null;
};

export type ManagedUserPage = {
  items: ManagedUserProjection[];
  nextCursor: string | null;
  total: number;
};

export type ReviewUserInput = {
  status: Extract<ManagedUserStatus, "active" | "rejected" | "suspended">;
  role?: ManagedUserRole;
};

import type { UserReference } from "@nodeprox/types";
