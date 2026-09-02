export function isOwner(actorId: string, ownerId: string): boolean {
  return actorId === ownerId;
}

/**
 * Series mutations remain contextual. This is deliberately distinct from
 * Chapter operational authority: a Gestor can support Chapters globally but
 * cannot administer a Series it does not own.
 */
export function canAdministerSeries(input: {
  role: "admin" | "gestor" | "uploader";
  isOwner: boolean;
  isAssigned: boolean;
}): boolean {
  if (input.role === "admin") return true;
  if (input.role === "gestor") return input.isOwner;
  return input.isAssigned;
}
