export function isOwner(actorId: string, ownerId: string): boolean {
  return actorId === ownerId;
}
