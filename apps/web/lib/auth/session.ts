import { ApiError } from "../api/types";
import { apiRequestServer } from "../api/server";
import type { SessionView } from "../api/types";

export async function getSession(): Promise<SessionView | null> {
  try {
    return await apiRequestServer<SessionView>("/auth/session");
  } catch (error) {
    if (error instanceof ApiError && error.status === 401) return null;
    throw error;
  }
}
