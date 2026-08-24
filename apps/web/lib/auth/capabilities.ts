import { getCapabilities as requestCapabilities } from "../domains/auth/server";
import type { CapabilityProjection } from "../domains/auth/types";

export type { CapabilityProjection } from "../domains/auth/types";

export function getCapabilities(): Promise<CapabilityProjection> {
  return requestCapabilities();
}
