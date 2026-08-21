import { apiRequestServer } from "../api/server";

export type CapabilityProjection = {
  capabilities: readonly string[];
};

export function getCapabilities(): Promise<CapabilityProjection> {
  return apiRequestServer<CapabilityProjection>("/auth/capabilities");
}
