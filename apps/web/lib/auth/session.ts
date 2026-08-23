import { ApiError } from "../api/types";
import { getSession as requestSession } from "../domains/auth/server";
import type { SessionView } from "../api/types";

export async function getSession(): Promise<SessionView | null> {
  try {
    return await requestSession();
  } catch (error) {
    if (error instanceof ApiError && error.status === 401) return null;
    throw error;
  }
}
