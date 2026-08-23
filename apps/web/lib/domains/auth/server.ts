import { apiRequestServer } from "../../api/server";
import type { SessionView } from "../../api/types";
import type { CapabilityProjection } from "./types";

export function getSession() {
  return apiRequestServer<SessionView>("/auth/session");
}

export function getCapabilities() {
  return apiRequestServer<CapabilityProjection>("/auth/capabilities");
}
