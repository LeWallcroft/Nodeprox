import {
  PERMISSIONS,
  type Permission,
} from "../../authorization/domain/permissions.js";
import type { Role } from "../../authorization/domain/roles.js";

export const DELEGABLE_CHAPTER_PERMISSIONS = [
  PERMISSIONS.CHAPTERS_READ,
  PERMISSIONS.CHAPTERS_EDIT,
  PERMISSIONS.CHAPTERS_REPLACE,
  PERMISSIONS.IMAGES_UPLOAD,
  PERMISSIONS.IMAGES_REPLACE,
  PERMISSIONS.IMAGES_REORDER,
  PERMISSIONS.IMAGES_DELETE,
] as const satisfies readonly Permission[];

export type DelegableChapterPermission =
  (typeof DELEGABLE_CHAPTER_PERMISSIONS)[number];

export function isDelegableChapterPermission(
  value: string,
): value is DelegableChapterPermission {
  return (DELEGABLE_CHAPTER_PERMISSIONS as readonly string[]).includes(value);
}

export function isCooldownActive(
  revokedAt: Date | null,
  cooldownDays: number,
  now: Date,
): boolean {
  if (!revokedAt || cooldownDays === 0) return false;
  return now.getTime() < revokedAt.getTime() + cooldownDays * 86_400_000;
}

export type ChapterContextualAuthorizationReason =
  | "role"
  | "assigned"
  | "helper";

export function evaluateChapterContextualAuthorization(input: {
  role: Role;
  isSeriesOwner: boolean;
  isAssigned: boolean;
  hasHelperPermission: boolean;
}): ChapterContextualAuthorizationReason | null {
  if (input.role === "admin") return "role";
  // Gestor is a global operational Chapter role. Series ownership remains
  // relevant to Series administration and helper management, not here.
  if (input.role === "gestor") return "role";
  if (input.role === "uploader" && input.isAssigned) return "assigned";
  return input.hasHelperPermission ? "helper" : null;
}

/**
 * Helper grants/revocations are Series administration, not ordinary Chapter
 * operations. Keep Gestor restricted to its own Series for that boundary.
 */
export function evaluateChapterAdministrationAuthorization(input: {
  role: Role;
  isSeriesOwner: boolean;
  isAssigned: boolean;
}): "role" | "assigned" | null {
  if (input.role === "admin") return "role";
  if (input.role === "gestor" && input.isSeriesOwner) return "role";
  if (input.role === "uploader" && input.isAssigned) return "assigned";
  return null;
}
