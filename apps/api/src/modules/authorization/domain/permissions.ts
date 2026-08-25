import type { Role } from "./roles.js";

export const PERMISSIONS = {
  SERIES_READ: "series.read",
  SERIES_CREATE: "series.create",
  SERIES_EDIT: "series.edit",
  SERIES_DELETE: "series.delete",
  CHAPTERS_READ: "chapters.read",
  CHAPTERS_CREATE: "chapters.create",
  CHAPTERS_EDIT: "chapters.edit",
  CHAPTERS_REPLACE: "chapters.replace",
  CHAPTERS_DELETE: "chapters.delete",
  CHAPTERS_HELPER_GRANT: "chapters.helper.grant",
  CHAPTERS_HELPER_REVOKE: "chapters.helper.revoke",
  IMAGES_UPLOAD: "images.upload",
  IMAGES_REPLACE: "images.replace",
  IMAGES_REORDER: "images.reorder",
  IMAGES_DELETE: "images.delete",
  APPROVALS_READ: "approvals.read",
  APPROVALS_CONSUME: "approvals.consume",
  APPROVALS_INVALIDATE: "approvals.invalidate",
  ADMIN_USERS_MANAGE: "admin.users.manage",
  ADMIN_SYSTEM_MANAGE: "admin.system.manage",
  ADMIN_STORAGE_MANAGE: "admin.storage.manage",
  ADMIN_API_MANAGE: "admin.api.manage",
} as const;

export type Permission = (typeof PERMISSIONS)[keyof typeof PERMISSIONS];

export const PERMISSION_CATALOG = Object.values(
  PERMISSIONS,
) as readonly Permission[];

const nonAdminPermissions = PERMISSION_CATALOG.filter(
  (permission) => !permission.startsWith("admin."),
);

export const ROLE_PERMISSIONS: Record<Role, readonly Permission[]> = {
  admin: PERMISSION_CATALOG,
  gestor: nonAdminPermissions,
  uploader: [
    PERMISSIONS.SERIES_READ,
    PERMISSIONS.CHAPTERS_READ,
    PERMISSIONS.CHAPTERS_CREATE,
    PERMISSIONS.CHAPTERS_EDIT,
    PERMISSIONS.CHAPTERS_REPLACE,
    PERMISSIONS.CHAPTERS_DELETE,
    PERMISSIONS.CHAPTERS_HELPER_GRANT,
    PERMISSIONS.CHAPTERS_HELPER_REVOKE,
    PERMISSIONS.IMAGES_UPLOAD,
    PERMISSIONS.IMAGES_REPLACE,
    PERMISSIONS.IMAGES_REORDER,
    PERMISSIONS.IMAGES_DELETE,
  ],
};

export function isPermission(value: string): value is Permission {
  return (PERMISSION_CATALOG as readonly string[]).includes(value);
}
