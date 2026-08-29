export type ManagedUserStatus = "pending" | "active" | "rejected" | "suspended";
export type ManagedUserRole = "admin" | "gestor" | "uploader";

export type ManagedUser = {
  id: string;
  email: string;
  discordUsername: string | null;
  status: ManagedUserStatus;
  role?: ManagedUserRole;
  createdAt: string;
  updatedAt: string;
};

export type ReviewUserInput = {
  status: Extract<ManagedUserStatus, "active" | "rejected" | "suspended">;
  role?: ManagedUserRole;
};
