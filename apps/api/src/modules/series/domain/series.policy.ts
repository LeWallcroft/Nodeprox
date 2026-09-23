import type { Role } from "../../authorization/domain/roles.js";

export function isOwner(actorId: string, ownerId: string): boolean {
  return actorId === ownerId;
}

export type SeriesAuthorizationInput = {
  role: Role;
  isOwner: boolean;
  isAssigned: boolean;
};

export type SeriesMutationOperation = "edit" | "assignment" | "delete";

export function canEditSeries(input: SeriesAuthorizationInput): boolean {
  return input.role === "admin" || input.role === "gestor" || input.isAssigned;
}

export function canManageSeriesAssignment(
  input: SeriesAuthorizationInput,
): boolean {
  return input.role === "admin" || input.role === "gestor" || input.isAssigned;
}

export function canDeleteSeries(input: SeriesAuthorizationInput): boolean {
  return input.role === "admin";
}

export function canPerformSeriesMutation(
  operation: SeriesMutationOperation,
  input: SeriesAuthorizationInput,
): boolean {
  switch (operation) {
    case "edit":
      return canEditSeries(input);
    case "assignment":
      return canManageSeriesAssignment(input);
    case "delete":
      return canDeleteSeries(input);
  }
}

/**
 * Legacy contextual authority retained only for Chapter helper management.
 * Edit, assignment, and delete must use their operation-specific policies.
 *
 * @deprecated Use canEditSeries, canManageSeriesAssignment, or
 * canDeleteSeries for Series mutations.
 */
export function canAdministerSeries(input: SeriesAuthorizationInput): boolean {
  if (input.role === "admin") return true;
  if (input.role === "gestor") return input.isOwner;
  return input.isAssigned;
}
