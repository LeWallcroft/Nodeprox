import type { Role } from "../../authorization/domain/roles.js";

const RESPONSIBLE_ROLES: readonly Role[] = ["admin", "gestor", "uploader"];

export function canBeSeriesResponsible(
  user: { status: string; role?: string | undefined } | null | undefined,
): user is { status: "active"; role: Role } {
  return Boolean(
    user?.status === "active" &&
      user.role &&
      RESPONSIBLE_ROLES.includes(user.role as Role),
  );
}
