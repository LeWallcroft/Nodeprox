import { hasCapability } from "../../auth/visibility";

/** A grant is required only when it is the actor's sole creation authority. */
export function requiresSeriesCreationGrant(
  capabilities: readonly string[] | undefined,
): boolean {
  return (
    !hasCapability(capabilities, "series.create") &&
    hasCapability(capabilities, "series.create.with-grant")
  );
}
