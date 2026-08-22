import {
  PERMISSIONS,
  type Permission,
} from "../../authorization/domain/permissions.js";

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
