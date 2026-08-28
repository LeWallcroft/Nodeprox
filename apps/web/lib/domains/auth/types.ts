import type { SessionView } from "../../api/types";

export type { SessionView };

export interface CapabilityProjection {
  capabilities: readonly string[];
}

export interface LoginInput {
  email: string;
  password: string;
}

export interface RegistrationInput {
  email: string;
  password: string;
}

export interface RegisteredAccount {
  id: string;
  email: string;
  status: "pending";
  role: "uploader";
  createdAt: string;
  updatedAt: string;
}
