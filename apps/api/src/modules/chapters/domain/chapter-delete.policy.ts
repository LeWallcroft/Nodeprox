import type { Permission } from "../../authorization/domain/permissions.js";
import type { Role } from "../../authorization/domain/roles.js";

export type ChapterDeleteDecision =
  | { allowed: true; reason: "admin" | "gestor" | "assigned" }
  | {
      allowed: false;
      reason: "wrong-permission" | "not-owner" | "role-denied";
    };

export function evaluateChapterDelete(input: {
  actorRole: Role | null;
  permission: Permission;
  assigned?: boolean;
  seriesOwner?: boolean;
}): ChapterDeleteDecision {
  if (input.permission !== "chapters.delete")
    return { allowed: false, reason: "wrong-permission" };
  if (input.actorRole === "admin") return { allowed: true, reason: "admin" };
  if (input.actorRole === "gestor") {
    return input.seriesOwner
      ? { allowed: true, reason: "gestor" }
      : { allowed: false, reason: "not-owner" };
  }
  if (input.actorRole === "uploader") {
    if (input.assigned) return { allowed: true, reason: "assigned" };
  }
  return { allowed: false, reason: "not-owner" };
}
