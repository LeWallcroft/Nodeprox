import type { Permission } from "../../authorization/domain/permissions.js";
import type { Role } from "../../authorization/domain/roles.js";

export type ChapterDeleteDecision =
  | { allowed: true; reason: "admin" | "gestor" | "owner" }
  | {
      allowed: false;
      reason: "wrong-permission" | "not-owner" | "role-denied";
    };

export function evaluateChapterDelete(input: {
  actorId: string;
  actorRole: Role | null;
  chapterOwnerId: string;
  permission: Permission;
}): ChapterDeleteDecision {
  if (input.permission !== "chapters.delete")
    return { allowed: false, reason: "wrong-permission" };
  if (input.actorRole === "admin") return { allowed: true, reason: "admin" };
  if (input.actorRole === "gestor") return { allowed: true, reason: "gestor" };
  if (input.actorId === input.chapterOwnerId && input.actorRole === "uploader")
    return { allowed: true, reason: "owner" };
  return { allowed: false, reason: "not-owner" };
}
